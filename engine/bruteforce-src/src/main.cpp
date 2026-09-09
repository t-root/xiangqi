// Giao thức dòng lệnh riêng của Brute-force — cố tình mô phỏng SÁT khuôn dạng dòng "info"/"bestmove"
// mà Pikafish (UCI) đã dùng, để tái dùng được phần lớn code phân tích cú pháp phía JS
// (preparePikafishQuery/handler trong xiangqi-analyzer.html) chỉ với vài chỗ đổi nhỏ.
//
// Lệnh hỗ trợ:
//   bruteforce                       -> in id + option, kết "bruteforceok"
//   isready                          -> "readyok"
//   setoption name X value Y         -> Threads / CheckStreak_* / KtcBudget
//   ucinewgame                       -> xoá bảng băm/lịch sử (khớp resetSearchTables)
//   position fen <fen> [moves ...]   -> nạp thế cờ
//   go budget <N> [movetime <ms>] [from <M>]
//                                     -> quét cạn dò thắng ép, đào sâu dần TỪ 1 (hoặc TỪ M nếu có
//                                        "from") tới N. Không có movetime thì KHÔNG giới hạn giờ
//                                        (chạy tới khi xong hẳn N), khớp đúng "Số nước cố định" của
//                                        app; có movetime thì dừng giữa chừng khi hết giờ, khớp
//                                        "Không giới hạn nước (♾️)". "from M" dùng cho "Tiếp Tục
//                                        Phân Tích": các mức 1..M-1 ĐÃ quét cạn xong ở lượt "go"
//                                        trước (app tự nhớ M = mức cuối cùng đã hoàn tất), khỏi
//                                        phải quét lại từ đầu — thời gian mới dồn hết cho mức tiếp
//                                        theo trở đi, đúng nghĩa "tiếp tục" chứ không phải "làm lại".
//   go positional depth <N> movetime <ms>
//                                     -> khi KHÔNG có thắng ép: chọn nước theo thế trận (Phase 2),
//                                        khớp positionalRootGen — dùng cho "chỉ đường"/"AI tự chơi".
//   stop                             -> dừng lượt "go" đang chạy, báo kết quả tốt nhất hiện có
//   quit                             -> thoát

#include "types.h"
#include "movegen.h"
#include "hash.h"
#include "eval.h"
#include "search.h"
#include "positional.h"
#include "fen.h"
#include <algorithm>
#include <iostream>
#include <sstream>
#include <thread>
#include <atomic>
#include <chrono>
#include <mutex>
#include <memory>
#include <unordered_map>
#include <functional>
#include <stdexcept>

#ifdef __EMSCRIPTEN__
    #include <emscripten/emscripten.h>
#endif

using namespace BruteForce;

namespace {

std::mutex g_outMutex;
void sendLine(const std::string& s) {
    std::lock_guard<std::mutex> lock(g_outMutex);
    std::cout << s << '\n' << std::flush;
}

Board g_board{};
bool g_positionValid = false;
Color g_sideToMove = Color::Red;
// Lịch sử lặp thế của ván đang chơi, dựng lại từ chuỗi "moves" của lệnh "position" (app gửi thế cờ
// nền ngay sau lần ăn quân gần nhất rồi liệt kê các nước từ đó tới nay). Không có nó thì pha thế
// trận luôn ngỡ mọi thế cờ vừa xuất hiện lần đầu, nên không phạt được đường lặp/chiếu mãi và có thể
// chọn nước tự thua theo luật lặp thế.
PositionHistory g_history;
CsSide g_restrictedSide = CsSide::None;
int g_checkStreakLimit = CHECK_STREAK_DEFAULT;
int g_threads = 1;  // dùng ở giai đoạn đa luồng (chưa bật ở bản này) — giữ option để UI không lỗi

// Chuỗi chiếu ĐÃ CÓ SẴN ở thế cờ gốc, mang theo từ ván đang chơi thật (app chỉ gửi board FEN hiện
// tại qua "position", không gửi lịch sử nước — không có 2 option này thì mọi lượt "go" đều ngỡ
// chuỗi chiếu vừa bắt đầu từ 0, có thể chọn nhầm một nước thật ra đã phạm luật giữa ván thật).
// 0 = chưa có quân nào giữ chuỗi.
CsCode g_csRootRed = 0, g_csRootBlack = 0;
bool g_ktcBudgetOn = false;

// Một mốc lịch sử lặp thế — khớp repetitionEntry của app (:1890-1896): gaveCheck chỉ có nghĩa khi
// đã có bên vừa đi, thế cờ xuất phát thì luôn false.
RepetitionEntry makeRepetitionEntry(const Board& b, Color sideToMove, Color mover) {
    HashPair hp = hashBoardPair(b);
    Square kingSq;
    bool gaveCheck = mover != Color::None
        && findKing(b, sideToMove, kingSq) && isKingAttacked(b, sideToMove, kingSq);
    return RepetitionEntry{hp.h1, hp.h2, sideToMove, mover, gaveCheck};
}

std::atomic<bool> g_cancelled{false};
std::atomic<bool> g_searching{false};
std::thread g_searchThread;

// Only the command thread resets cancellation, before publishing a new worker.
// A worker must never erase a stop received before it was scheduled.
template<typename Function, typename... Args>
void startSearch(Function function, Args... args) {
    if (!g_positionValid) throw std::invalid_argument("position is not valid");
    g_cancelled = false;
    g_searching = true;
    try {
        g_searchThread = std::thread([=] {
            try { function(args...); }
            catch (const std::exception& error) {
                sendLine(std::string("info string ERROR: search failed: ") + error.what());
                sendLine("bestmove (none)");
            }
            catch (...) {
                sendLine("info string ERROR: search failed");
                sendLine("bestmove (none)");
            }
            g_searching = false;
        });
    } catch (...) { g_searching = false; throw; }
}

// Session cache theo tung nhanh. Luu TT/witness va moc budget da quet tron. Day la WARM RESTART:
// stack de-quy dang do chua duoc serialize, nhung slice sau khong xoa TT va khong quet lai cac moc
// budget da PROVEN. Giao thuc tach rieng de UI khong nham no voi true tree resume.
struct SearchSession {
    Board board{};
    Color sideToMove = Color::Red;
    PositionHistory history;
    CsSide restrictedSide = CsSide::None;
    int checkStreakLimit = CHECK_STREAK_DEFAULT;
    CsCode csRootRed = 0, csRootBlack = 0;
    bool ktcBudgetOn = false;
    MateSearchState state;
    int activeBudget = 0;
    int completedBudget = 0;
    long long accumulatedMs = 0;
    int sliceCount = 0;
};

std::unordered_map<std::string, std::unique_ptr<SearchSession>> g_searchSessions;

MateSearchState makeWorkerState(const MateSearchState& base) {
    MateSearchState worker;
    worker.restrictedSide = base.restrictedSide;
    worker.checkStreakLimit = base.checkStreakLimit;
    worker.ktcBudgetOn = base.ktcBudgetOn;
    worker.ktcExemptColor = base.ktcExemptColor;
    worker.cancelled = base.cancelled;
    worker.deadline = base.deadline;
    return worker;
}

void captureSession(SearchSession& session) {
    session.board = g_board;
    session.sideToMove = g_sideToMove;
    session.history = g_history;
    session.restrictedSide = g_restrictedSide;
    session.checkStreakLimit = g_checkStreakLimit;
    session.csRootRed = g_csRootRed;
    session.csRootBlack = g_csRootBlack;
    session.ktcBudgetOn = g_ktcBudgetOn;
}

void restoreSession(const SearchSession& session) {
    g_board = session.board;
    g_positionValid = true;
    g_sideToMove = session.sideToMove;
    g_history = session.history;
    g_restrictedSide = session.restrictedSide;
    g_checkStreakLimit = session.checkStreakLimit;
    g_csRootRed = session.csRootRed;
    g_csRootBlack = session.csRootBlack;
    g_ktcBudgetOn = session.ktcBudgetOn;
}

// Chỉ chia các nước GỐC: mọi nhánh con vẫn chạy alpha-beta y hệt bản một luồng. Vì mỗi worker
// sở hữu board, TT và heuristic riêng, không có khoá nào trong đường nóng và kết quả chiếu bí vẫn
// là kết quả quét cạn tuyệt đối. Giới hạn 4 để không nhân bảng băm 16 MB quá nhiều lần.
SearchResult searchMateRootParallel(Board& board, Color color, int redBudget, int blackBudget,
                                    i32 alpha, i32 beta, i32 h1, i32 h2,
                                    CsCode csRed, CsCode csBlack, MateSearchState& st, int requestedThreads) {
    if (requestedThreads <= 1) {
        SearchResult result = negamaxForcedMateGen(board, color, redBudget, blackBudget, 0, alpha, beta,
                                                    h1, h2, csRed, csBlack, st);
        if (result.score > MATE_THRESHOLD || result.score < -MATE_THRESHOLD) {
            std::vector<Move> witness = rebuildMateWitnessLine(board, color, redBudget, blackBudget,
                                                                csRed, csBlack, st);
            if (!witness.empty()) result.line = std::move(witness);
        }
        return result;
    }
    std::vector<Move> rootMoves = forcedMateRootMoves(board, color, st);
    int workerCount = std::min({std::max(1, requestedThreads), 4, static_cast<int>(rootMoves.size())});
    if (workerCount <= 1 || std::min(redBudget, blackBudget) <= 2 || rootMoves.size() < 16) {
        SearchResult result = negamaxForcedMateGen(board, color, redBudget, blackBudget, 0, alpha, beta,
                                                    h1, h2, csRed, csBlack, st);
        if (result.score > MATE_THRESHOLD || result.score < -MATE_THRESHOLD) {
            std::vector<Move> witness = rebuildMateWitnessLine(board, color, redBudget, blackBudget,
                                                                csRed, csBlack, st);
            if (!witness.empty()) result.line = std::move(witness);
        }
        return result;
    }

    struct WorkerResult { SearchResult best; i64 nodes = 0; };
    std::vector<WorkerResult> results(static_cast<size_t>(workerCount));
    std::atomic<size_t> nextMove{0};
    std::vector<std::thread> workers;
    workers.reserve(static_cast<size_t>(workerCount));

    for (int workerIndex = 0; workerIndex < workerCount; ++workerIndex) {
        workers.emplace_back([&, workerIndex] {
            Board localBoard = board;
            MateSearchState local = makeWorkerState(st);
            WorkerResult& result = results[static_cast<size_t>(workerIndex)];
            result.best.score = -SEARCH_INF;

            while (!local.isCancelled() && !local.timeUp()) {
                size_t index = nextMove.fetch_add(1, std::memory_order_relaxed);
                if (index >= rootMoves.size()) break;
                std::vector<Move> oneMove{rootMoves[index]};
                SearchResult current = negamaxForcedMateRootSubsetGen(
                    localBoard, color, redBudget, blackBudget, oneMove, alpha, beta,
                    h1, h2, csRed, csBlack, local);
                if (current.score > MATE_THRESHOLD || current.score < -MATE_THRESHOLD) {
                    std::vector<Move> witness = rebuildMateWitnessLine(localBoard, color, redBudget, blackBudget,
                                                                        csRed, csBlack, local);
                    if (!witness.empty()) current.line = std::move(witness);
                }
                if (current.score > result.best.score) result.best = std::move(current);
            }
            result.nodes = local.nodeCounter;
        });
    }
    for (auto& worker : workers) worker.join();

    SearchResult best;
    best.score = -SEARCH_INF;
    for (const WorkerResult& result : results) {
        st.nodeCounter += result.nodes;
        if (result.best.score > best.score) best = result.best;
    }
    return best;
}

ProbeResult probeForcedMate(Board& board, Color color, int redBudget, int blackBudget,
                            CsCode csRed, CsCode csBlack, MateSearchState& st, int threads) {
    HashPair hp = hashBoardPair(board);
    Color savedExempt = st.ktcExemptColor;
    Color opp = otherColor(color);

    int winRed = redBudget, winBlack = blackBudget;
    ktcSearchBudgets(color, redBudget, blackBudget, st.ktcBudgetOn, winRed, winBlack);
    st.ktcExemptColor = color;
    SearchResult win = searchMateRootParallel(board, color, winRed, winBlack, MATE_THRESHOLD, MATE_SCORE,
                                                hp.h1, hp.h2, csRed, csBlack, st, threads);
    if (win.score > MATE_THRESHOLD) {
        st.ktcExemptColor = savedExempt;
        return {true, win.score, win.line};
    }

    int lossRed = redBudget, lossBlack = blackBudget;
    ktcSearchBudgets(opp, redBudget, blackBudget, st.ktcBudgetOn, lossRed, lossBlack);
    st.ktcExemptColor = opp;
    SearchResult loss = searchMateRootParallel(board, color, lossRed, lossBlack, -MATE_SCORE, -MATE_THRESHOLD,
                                                 hp.h1, hp.h2, csRed, csBlack, st, threads);
    st.ktcExemptColor = savedExempt;
    if (loss.score < -MATE_THRESHOLD) return {true, loss.score, loss.line};
    return {false, 0, {}};
}

PositionalSearchState makePositionalWorkerState(const PositionalSearchState& base) {
    PositionalSearchState worker;
    worker.historyScores = base.historyScores;
    worker.restrictedSide = base.restrictedSide;
    worker.checkStreakLimit = base.checkStreakLimit;
    worker.history = base.history;
    worker.cancelled = base.cancelled;
    worker.deadline = base.deadline;
    return worker;
}

PositionalRootResult searchPositionalRootParallel(Board& board, Color color, int depth,
                                                   const std::vector<Move>& rootMoves,
                                                   CsCode csRed, CsCode csBlack,
                                                   PositionalSearchState& st, int requestedThreads) {
    int workerCount = std::min({std::max(1, requestedThreads), 4, static_cast<int>(rootMoves.size())});
    if (workerCount <= 1 || depth <= 3 || rootMoves.size() < 16) {
        return positionalRoot(board, color, depth, rootMoves, csRed, csBlack, st);
    }

    struct WorkerResult { PositionalRootResult best; size_t bestIndex; i64 nodes = 0; };
    std::vector<WorkerResult> results(static_cast<size_t>(workerCount));
    std::atomic<size_t> nextMove{0};
    std::vector<std::thread> workers;
    workers.reserve(static_cast<size_t>(workerCount));

    for (int workerIndex = 0; workerIndex < workerCount; ++workerIndex) {
        workers.emplace_back([&, workerIndex] {
            Board localBoard = board;
            PositionalSearchState local = makePositionalWorkerState(st);
            WorkerResult& result = results[static_cast<size_t>(workerIndex)];
            result.bestIndex = rootMoves.size();

            while (!(local.cancelled && local.cancelled->load(std::memory_order_relaxed)) && !local.timeUp()) {
                size_t index = nextMove.fetch_add(1, std::memory_order_relaxed);
                if (index >= rootMoves.size()) break;
                std::vector<Move> oneMove{rootMoves[index]};
                PositionalRootResult current = positionalRoot(localBoard, color, depth, oneMove,
                                                              csRed, csBlack, local);
                if (current.hasMove && (!result.best.hasMove || current.score > result.best.score
                    || (current.score == result.best.score && index < result.bestIndex))) {
                    result.best = current;
                    result.bestIndex = index;
                }
            }
            result.nodes = local.nodeCounter;
        });
    }
    for (auto& worker : workers) worker.join();

    PositionalRootResult best;
    size_t bestIndex = rootMoves.size();
    for (const WorkerResult& result : results) {
        st.nodeCounter += result.nodes;
        if (result.best.hasMove && (!best.hasMove || result.best.score > best.score
            || (result.best.score == best.score && result.bestIndex < bestIndex))) {
            best = result.best;
            bestIndex = result.bestIndex;
        }
    }
    return best;
}

std::string formatPv(const std::vector<Move>& line) {
    std::string s;
    for (size_t i = 0; i < line.size(); ++i) {
        if (i) s += ' ';
        s += moveToUci(line[i]);
    }
    return s.empty() ? "" : " pv " + s;
}

// Đào sâu dần budget fromBudget..N — khớp cấu trúc nextDepth() trong runDeepeningAnalysisChunked
// (xiangqi-analyzer.html:3853-3903), thu gọn cho một luồng (chưa chia pool đa luồng). fromBudget=1
// là lượt "Bắt Đầu Phân Tích" bình thường; fromBudget>1 là "Tiếp Tục Phân Tích" — các mức
// 1..fromBudget-1 app đã biết CHẮC CHẮN không có thắng ép (đã quét cạn xong ở lượt "go" trước),
// nên bỏ qua, không quét lại — mọi giây mới xin thêm dồn thẳng cho mức tiếp theo trở đi.
void runGoBudget(int maxBudget, long long movetimeMs, int fromBudget, SearchSession* session = nullptr) {
    if (maxBudget < 1 || maxBudget > UNLIMITED_MAX_BUDGET_PER_SIDE || fromBudget > maxBudget)
        throw std::invalid_argument("budget must be 1..60 and from <= budget");
    if (movetimeMs < 0 || movetimeMs > 86400000) throw std::invalid_argument("invalid movetime");
    auto t0 = std::chrono::steady_clock::now();
    auto deadline = (movetimeMs > 0)
        ? t0 + std::chrono::milliseconds(movetimeMs)
        : std::chrono::steady_clock::time_point::max();

    auto freshState = session ? nullptr : std::make_unique<MateSearchState>();
    MateSearchState& st = session ? session->state : *freshState;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    st.deadline = deadline;  // để một mức budget đang chạy dở tự dừng đúng hạn, không tràn qua giờ
                              // (đã thấy thật: xin movetime 3s nhưng chạy tới 15s — vòng lặp NGOÀI
                              // chỉ kiểm tra giờ GIỮA các mức, một mức chạy lâu vẫn không bị chặn).

    Board board = g_board;
    Color color = g_sideToMove;
    if (session) fromBudget = std::max(fromBudget, session->completedBudget + 1);
    int doneBudget = session ? session->completedBudget : (fromBudget > 1 ? fromBudget - 1 : 0);
    ProbeResult lastMate;
    bool foundMate = false;

    for (int budget = std::max(1, fromBudget); budget <= maxBudget; ++budget) {
        if (g_cancelled.load() || std::chrono::steady_clock::now() > deadline) break;

        if (!session || session->activeBudget != budget) {
            st.tt.clear();
            st.mateWitness.clear();
            if (session) session->activeBudget = budget;
        }
        Board scratch = board;
        ProbeResult res = probeForcedMate(scratch, color, budget, budget,
            g_csRootRed, g_csRootBlack, st, g_threads);
        // Bị huỷ HOẶC hết giờ GIỮA mức budget này: res có thể bị cắt dở ở bất kỳ nhánh nào, không
        // còn là kết quả "đã quét cạn xong, chắc chắn" — Brute-force CAM KẾT chỉ báo cáo mức đã quét
        // TRỌN VẸN. Dừng ngay, giữ nguyên doneBudget/kết quả của mức TRƯỚC (nếu có) — khớp đúng
        // nguyên tắc "completedFully" đã áp cho runGoPositional bên dưới.
        if (g_cancelled.load() || st.timeUp()) break;

        doneBudget = budget;
        if (session) session->completedBudget = budget;
        long long elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - t0).count();

        if (res.mate) {
            foundMate = true; lastMate = res;
            int k = g_ktcBudgetOn ? budget
                : ((res.score > 0) ? (MATE_SCORE - res.score + 1) / 2 : (MATE_SCORE + res.score) / 2);
            std::ostringstream line;
            line << "info depth " << budget << " score mate " << (res.score > 0 ? k : -k)
                 << " nodes " << st.nodeCounter << " time " << elapsedMs;
            sendLine(line.str() + formatPv(res.line));
            break;  // budget đầu tiên chứng minh được mate CHÍNH LÀ số nước tối thiểu — dừng ngay,
                    // khớp :2020-2045 (mateDepth tăng dần, gặp mate là chốt, không đào tiếp).
        } else {
            std::ostringstream line;
            line << "info depth " << budget << " score cp 0 nodes " << st.nodeCounter << " time " << elapsedMs;
            sendLine(line.str());
        }
    }

    if (session) {
        session->accumulatedMs += std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - t0).count();
        session->sliceCount++;
        std::ostringstream progress;
        progress << "info string session warm accumulated " << session->accumulatedMs
                 << " slices " << session->sliceCount << " completed " << session->completedBudget;
        sendLine(progress.str());
    }

    if (g_cancelled.load()) {
        sendLine("info string cancelled");
        sendLine("info string outcome partial");
        sendLine("bestmove (none)");
        g_searching = false;
        return;
    }

    if (foundMate) {
        sendLine("bestmove " + (lastMate.line.empty() ? "(none)" : moveToUci(lastMate.line[0])));
    } else if (doneBudget >= maxBudget) {
        sendLine("info string outcome draw");  // đã quét TRỌN maxBudget, không có thắng ép — chắc chắn
        sendLine("bestmove (none)");
    } else {
        sendLine("info string outcome partial");  // hết giờ giữa chừng, chưa quét hết maxBudget
        sendLine("bestmove (none)");
    }
    g_searching = false;
}

// Khớp phase "positional" của runAiSearchPipeline (finishPositional loop, xiangqi-analyzer.html
// ~:2050-2085): ĐÀO SÂU DẦN posDepth=1,2,3... có hạn giờ (finalDeadline), KHÔNG chạy thẳng tới
// depth cố định — độ sâu cố định không kiểm tra giờ có thể treo rất lâu ở các nước cờ đông quân
// (đã thấy thật: depth=6 trên khai cuộc chuẩn mất >15s một luồng). maxDepth là TRẦN trên (khớp
// AI_POSITIONAL_MAX_DEPTH=12), movetimeMs là hạn giờ thật sự quyết định dừng ở đâu.
// Lịch sử lặp thế lấy từ g_history — dựng ở handlePosition theo chuỗi "moves" mà app gửi kèm. Nhờ
// vậy pha thế trận phạt được đường lặp thế/chiếu mãi đúng như bản JS lúc đang chơi thật, chứ không
// còn ngỡ mọi thế cờ đều mới xuất hiện lần đầu (app chỉ gửi FEN trơn thì g_history chỉ có thế gốc,
// mọi phạt lặp bằng 0 — vẫn chạy đúng, chỉ là không biết gì về lịch sử).
// Probe một cặp ngân sách R/B đã còn lại sau một nước của line. Khác với
// go budget N (N/N), kết quả draw ở đây đúng với số nước còn lại từng bên.
void runGoBudgetPair(int redBudget, int blackBudget, long long movetimeMs, SearchSession* session = nullptr) {
    if (redBudget < 0 || blackBudget < 0 || redBudget > UNLIMITED_MAX_BUDGET_PER_SIDE || blackBudget > UNLIMITED_MAX_BUDGET_PER_SIDE)
        throw std::invalid_argument("budgets must be 0..60");
    if (movetimeMs < 0 || movetimeMs > 86400000) throw std::invalid_argument("invalid movetime");
    auto t0 = std::chrono::steady_clock::now();
    auto deadline = (movetimeMs > 0)
        ? t0 + std::chrono::milliseconds(movetimeMs)
        : std::chrono::steady_clock::time_point::max();

    auto freshState = session ? nullptr : std::make_unique<MateSearchState>();
    MateSearchState& st = session ? session->state : *freshState;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    st.deadline = deadline;

    Board board = g_board;
    Color color = g_sideToMove;
    Board scratch = board;
    ProbeResult res = probeForcedMate(scratch, color, std::max(0, redBudget), std::max(0, blackBudget),
                                      g_csRootRed, g_csRootBlack, st, g_threads);
    if (session) {
        session->accumulatedMs += std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - t0).count();
        session->sliceCount++;
        std::ostringstream progress;
        progress << "info string session warm accumulated " << session->accumulatedMs
                 << " slices " << session->sliceCount;
        sendLine(progress.str());
    }
    if (g_cancelled.load()) {
        sendLine("info string cancelled");
        sendLine("info string outcome partial");
        sendLine("bestmove (none)");
        g_searching = false;
        return;
    }
    if (st.timeUp()) {
        sendLine("info string outcome partial");
        sendLine("bestmove (none)");
        g_searching = false;
        return;
    }

    const int depth = std::max(redBudget, blackBudget);
    const long long elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0).count();
    if (res.mate) {
        int k = g_ktcBudgetOn ? depth
            : ((res.score > 0) ? (MATE_SCORE - res.score + 1) / 2 : (MATE_SCORE + res.score) / 2);
        std::ostringstream line;
        line << "info depth " << depth << " score mate " << (res.score > 0 ? k : -k)
             << " nodes " << st.nodeCounter << " time " << elapsedMs;
        sendLine(line.str() + formatPv(res.line));
        sendLine("bestmove " + (res.line.empty() ? "(none)" : moveToUci(res.line[0])));
    } else {
        std::ostringstream line;
        line << "info depth " << depth << " score cp 0 nodes " << st.nodeCounter << " time " << elapsedMs;
        sendLine(line.str());
        sendLine("info string outcome draw");
        sendLine("bestmove (none)");
    }
    g_searching = false;
}

// Dựng trọn một line hòa bằng chính bộ dò mate của Brute-force. Mỗi ứng viên
// được thử với đúng số nước còn lại của Đỏ/Đen; chỉ giữ nước sau đó vẫn không
// có thắng ép cho cả hai bên. Vì vậy không còn tình trạng UI chỉ có nước đầu.
void runGoDrawLine(int redBudget, int blackBudget) {
    if (redBudget < 0 || blackBudget < 0 || redBudget > UNLIMITED_MAX_BUDGET_PER_SIDE || blackBudget > UNLIMITED_MAX_BUDGET_PER_SIDE)
        throw std::invalid_argument("budgets must be 0..60");
    auto t0 = std::chrono::steady_clock::now();

    MateSearchState st;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    st.deadline = std::chrono::steady_clock::time_point::max();

    Board board = g_board;
    Color side = g_sideToMove;
    std::vector<Move> line;
    const int targetRed = std::max(0, redBudget);
    const int targetBlack = std::max(0, blackBudget);
    int remainRed = targetRed, remainBlack = targetBlack;
    const int maxPly = std::max(1, targetRed + targetBlack + 4);
    bool complete = true;

    for (int ply = 0; ply < maxPly && (remainRed > 0 || remainBlack > 0); ++ply) {
        if (g_cancelled.load()) { complete = false; break; }
        std::vector<Move> legal;
        generateLegalMoves(board, side, legal);
        bool chosen = false;
        for (const Move& move : legal) {
            if (g_cancelled.load()) { complete = false; break; }
            const Piece captured = makeMoveInPlace(board, move);
            int afterRed = remainRed, afterBlack = remainBlack;
            if (side == Color::Red) afterRed = std::max(0, afterRed - 1);
            else afterBlack = std::max(0, afterBlack - 1);
            st.reset();
            ProbeResult probe = probeForcedMate(board, otherColor(side), afterRed, afterBlack,
                                                 g_csRootRed, g_csRootBlack, st, g_threads);
            undoMoveInPlace(board, move, captured);
            if (g_cancelled.load()) { complete = false; break; }
            if (!probe.mate) {
                makeMoveInPlace(board, move);
                remainRed = afterRed;
                remainBlack = afterBlack;
                line.push_back(move);
                side = otherColor(side);
                chosen = true;
                break;
            }
        }
        if (!chosen) { complete = false; break; }
    }

    if (g_cancelled.load()) {
        sendLine("info string cancelled");
        sendLine("info string outcome partial");
        sendLine("bestmove (none)");
        g_searching = false;
        return;
    }

    const int depth = std::max(targetRed, targetBlack);
    const long long elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0).count();
    std::ostringstream info;
    info << "info depth " << depth << " score cp 0 nodes " << st.nodeCounter << " time " << elapsedMs;
    sendLine(info.str() + formatPv(line));
    if (complete && remainRed == 0 && remainBlack == 0) {
        sendLine("info string outcome draw");
        sendLine("bestmove " + (line.empty() ? "(none)" : moveToUci(line[0])));
    } else {
        sendLine("info string outcome partial");
        sendLine("bestmove (none)");
    }
    g_searching = false;
}

void runGoPositional(int maxDepth, long long movetimeMs) {
    if (maxDepth < 1 || maxDepth > AI_POSITIONAL_MAX_DEPTH) throw std::invalid_argument("depth must be 1..12");
    if (movetimeMs < 0 || movetimeMs > 86400000) throw std::invalid_argument("invalid movetime");
    auto t0 = std::chrono::steady_clock::now();
    if (movetimeMs <= 0) movetimeMs = AI_MOVE_TIME_LIMIT_MS;  // luôn có hạn giờ, khớp tinh thần bản gốc
    auto deadline = t0 + std::chrono::milliseconds(movetimeMs);

    PositionalSearchState st;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.cancelled = &g_cancelled;
    st.deadline = deadline;  // để một độ sâu đang chạy dở tự dừng đúng hạn, không tràn qua giờ
    st.history = &g_history;

    Board board = g_board;
    Color color = g_sideToMove;

    std::vector<Move> ordered;
    {
        std::vector<ScoredMoveP> scored;
        std::vector<Move> legal;
        generateLegalMoves(board, color, legal);
        for (auto& m : legal) {
            ScoredMoveP sm; sm.from = m.from; sm.to = m.to;
            sm.piece = board[m.from.row][m.from.col]; sm.captured = board[m.to.row][m.to.col];
            scored.push_back(sm);
        }
        orderMoves(scored, st);
        ordered.assign(scored.begin(), scored.end());
    }

    PositionalRootResult best;
    int doneDepth = 0;
    for (int depth = 1; depth <= maxDepth; ++depth) {
        if (g_cancelled.load() || st.timeUp()) break;
        PositionalRootResult res = searchPositionalRootParallel(board, color, depth, ordered,
            g_csRootRed, g_csRootBlack, st, g_threads);
        // Hết giờ/bị huỷ GIỮA một độ sâu vẫn có thể trả về res.hasMove=true (đã xét xong vài nước
        // gốc trước khi dừng) — CHỈ tin kết quả của một độ sâu đã đi hết TRỌN VẸN tất cả nước gốc,
        // không thì "best move" có thể lệch (so sánh chưa công bằng giữa các nhánh). Nhận biết
        // "trọn vẹn" qua việc kiểm tra huỷ/hết giờ ẤY XẢY RA SAU khi gọi xong, không phải suy đoán.
        bool completedFully = !(g_cancelled.load() || st.timeUp());
        if (res.hasMove && completedFully) {
            best = res; doneDepth = depth;
            long long elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - t0).count();
            std::ostringstream line;
            line << "info depth " << depth << " score cp " << res.rawScore
                 << " nodes " << st.nodeCounter << " time " << elapsedMs << " pv " << moveToUci(res.move);
            sendLine(line.str());
        } else {
            break;  // độ sâu này dở dang (hết giờ/huỷ giữa chừng) — dùng kết quả độ sâu TRƯỚC đó
        }
    }

    if (doneDepth == 0 || !best.hasMove) {
        sendLine("bestmove (none)");
    } else {
        sendLine("bestmove " + moveToUci(best.move));
    }
    g_searching = false;
}

void stopSearch() {
    // PHẢI join bất cứ khi nào thread cũ còn joinable — không chỉ khi g_searching còn true.
    // Một lượt search đã tự xong (mate tìm thấy ngay, thread tự return) mà chưa từng bị join()
    // vẫn ở trạng thái joinable; gán đè g_searchThread = std::thread(...) cho lượt mới trong khi
    // đối tượng cũ còn joinable là undefined behavior — std::thread gọi std::terminate(), sập cả
    // tiến trình (đã thấy thật: exit code 0xC0000005 ngay lượt "go" thứ hai).
    g_cancelled = true;
    if (g_searchThread.joinable()) g_searchThread.join();
}

void handleSetOption(std::istringstream& iss) {
    // Cùng lý do với handlePosition: g_restrictedSide/g_checkStreakLimit/g_csRoot* bị một search
    // thread đang chạy đọc vào MateSearchState/PositionalSearchState ở đầu hàm — đổi giữa chừng
    // (không dừng thread cũ trước) là race, dù ít nghiêm trọng hơn (toàn số nguyên/enum đơn, không
    // phải cấu trúc lớn như Board) nhưng vẫn là undefined behavior thật sự trong C++.
    stopSearch();
    std::string tok, name, value;
    iss >> tok;  // "name"
    // Tên option có thể có khoảng trắng (không dùng ở đây, nhưng đọc an toàn tới "value").
    std::string word;
    while (iss >> word && word != "value") { name += (name.empty() ? "" : " ") + word; }
    std::getline(iss, value);
    if (!value.empty() && value[0] == ' ') value.erase(0, 1);

    if (name == "Threads") {
        // Chia nhánh gốc làm mất cắt tỉa alpha-beta giữa các nước, nên thực tế chậm hơn bản đơn luồng.
        // Giữ giao thức option để UI tương thích, nhưng luôn dùng đường tìm kiếm nhanh hơn là một luồng.
        g_threads = 1;
    }
    else if (name == "CheckStreak_RestrictedColor") {
        // "both" = cả hai bên bị giới hạn (chế độ Duyệt & Điều Khiển của app); "white"/"black" =
        // chỉ bên đó (chế độ Phân Tích, bất đối xứng); còn lại = tắt luật.
        g_restrictedSide = (value == "white") ? CsSide::Red
            : (value == "black") ? CsSide::Black
            : (value == "both") ? CsSide::Both : CsSide::None;
    } else if (name == "CheckStreak_Limit") {
        try { g_checkStreakLimit = std::max(1, std::stoi(value)); } catch (...) {}
    } else if (name == "CheckStreak_RootRed") {
        g_csRootRed = parseCheckStreakRootOption(value);
    } else if (name == "CheckStreak_RootBlack") {
        g_csRootBlack = parseCheckStreakRootOption(value);
    } else if (name == "KtcBudget") {
        g_ktcBudgetOn = (value == "true" || value == "1" || value == "on");
    }
}

void handlePosition(std::istringstream& iss) {
    // PHẢI dừng hẳn lượt search đang chạy dở (nếu có) TRƯỚC khi đổi g_board/g_sideToMove — không
    // thì có race thật: thread search đọc "Board board = g_board;" ở đầu runGoBudget/runGoPositional
    // TRONG LÚC main loop này vừa ghi đè g_board bằng thế cờ MỚI, search sẽ (thấy thật) tính nhầm
    // trên thế cờ chưa đúng — hai lượt "go" gửi liên tiếp không đợi bestmove giữa chừng có thể ra
    // "chiếu bí" trên thế cờ hoàn toàn khác thế cờ vừa gửi. stopSearch() vô hại khi không có gì
    // đang chạy (chỉ kiểm tra joinable()).
    stopSearch();
    std::string tok;
    g_positionValid = false;
    iss >> tok;  // "fen"
    if (tok != "fen") throw std::invalid_argument("expected position fen");
    std::string fen;
    // FEN có nhiều token cách nhau bởi khoảng trắng — đọc cho tới khi gặp "moves" hoặc hết dòng.
    std::string word;
    std::vector<std::string> fenTokens;
    while (iss >> word) {
        if (word == "moves") break;
        fenTokens.push_back(word);
    }
    for (size_t i = 0; i < fenTokens.size(); ++i) { if (i) fen += ' '; fen += fenTokens[i]; }

    auto parsed = parseXiangqiFen(fen);
    if (!parsed) throw std::invalid_argument("invalid FEN");
    g_board = parsed->board;
    g_sideToMove = parsed->sideToMove;
    g_history.clear();
    g_history.push(makeRepetitionEntry(g_board, g_sideToMove, Color::None));

    if (word == "moves") {
        std::string mv;
        while (iss >> mv) {
            auto m = parseUciMove(mv);
            if (!m) throw std::invalid_argument("invalid move coordinates");
            std::vector<Move> legal;
            generateLegalMoves(g_board, g_sideToMove, legal);
            if (std::find(legal.begin(), legal.end(), *m) == legal.end())
                throw std::invalid_argument("illegal position move");
            Piece pc = g_board[m->from.row][m->from.col];
            bool captured = !g_board[m->to.row][m->to.col].empty();
            g_board[m->to.row][m->to.col] = pc;
            g_board[m->from.row][m->from.col] = Piece{};
            Color mover = g_sideToMove;
            g_sideToMove = otherColor(g_sideToMove);
            // Ăn quân là mốc không thể quay lại nữa: lịch sử lặp thế tính lại từ đó, khớp đúng chỗ
            // executeMove của app xoá positionHistory (:2592).
            if (captured) g_history.clear();
            g_history.push(makeRepetitionEntry(g_board, g_sideToMove, mover));
        }
    }
    g_positionValid = true;
}

}  // namespace

bool executeCommandLine(const std::string& line) {
        std::istringstream iss(line);
        std::string cmd;
        iss >> cmd;

        if (cmd == "bruteforce") {
            sendLine("id name Brute-force");
            sendLine("id author cong dong du an Xiangqi Analyzer");
            sendLine("option name Threads type spin default 1 min 1 max 32");
            sendLine("option name CheckStreak_RestrictedColor type string default none");
            sendLine("option name CheckStreak_Limit type spin default 2 min 1 max 20");
            sendLine("option name CheckStreak_RootRed type string default none");
            sendLine("option name CheckStreak_RootBlack type string default none");
            sendLine("option name KtcBudget type check default false");
            sendLine("bruteforceok");
        } else if (cmd == "isready") {
            sendLine("readyok");
        } else if (cmd == "setoption") {
            handleSetOption(iss);
        } else if (cmd == "ucinewgame") {
            // Không có bảng dùng chung giữa các lượt "go" ở bản đơn luồng này (mỗi lượt tự tạo
            // MateSearchState riêng), chỉ cần bỏ lịch sử lặp thế của ván trước.
            stopSearch();
            g_history.clear();
            g_searchSessions.clear();
        } else if (cmd == "position") {
            handlePosition(iss);
        } else if (cmd == "search") {
            std::string action, jobId;
            iss >> action >> jobId;
            stopSearch();
            if (action == "create") {
                if (!g_positionValid) throw std::invalid_argument("position is not valid");
                if (!jobId.empty() && g_searchSessions.find(jobId) == g_searchSessions.end()) {
                    // Each session owns at least 16 MiB of TT storage.
                    if (g_searchSessions.size() >= 16) {
                        sendLine("info string ERROR: search session limit reached; cancel unused sessions");
                        return true;
                    }
                    auto session = std::make_unique<SearchSession>();
                    captureSession(*session);
                    g_searchSessions.emplace(jobId, std::move(session));
                }
                sendLine("info string search created " + jobId + " continuation warm");
            } else if (action == "cancel") {
                g_searchSessions.erase(jobId);
                sendLine("info string search cancelled " + jobId);
            } else if (action == "finish") {
                auto it = g_searchSessions.find(jobId);
                if (it == g_searchSessions.end()) sendLine("info string ERROR: unknown search session " + jobId);
                else {
                    std::ostringstream status;
                    status << "info string search " << jobId << " accumulated " << it->second->accumulatedMs
                           << " slices " << it->second->sliceCount << " completed " << it->second->completedBudget;
                    sendLine(status.str());
                }
            } else if (action == "slice" || action == "resume") {
                auto it = g_searchSessions.find(jobId);
                if (it == g_searchSessions.end()) {
                    sendLine("info string ERROR: unknown search session " + jobId);
                    sendLine("bestmove (none)");
                } else {
                    SearchSession* session = it->second.get();
                    restoreSession(*session);
                    std::string mode;
                    iss >> mode;
                    long long movetimeMs = 0;
                    if (mode == "budgets") {
                        int redBudget = 0, blackBudget = 0;
                        std::string word;
                        while (iss >> word) {
                            if (word == "red") iss >> redBudget;
                            else if (word == "black") iss >> blackBudget;
                            else if (word == "movetime") iss >> movetimeMs;
                        }
                        startSearch(runGoBudgetPair, redBudget, blackBudget, movetimeMs, session);
                    } else {
                        int budget = 0, fromBudget = 1;
                        if (mode == "budget") iss >> budget;
                        std::string word;
                        while (iss >> word) {
                            if (word == "budget") iss >> budget;
                            else if (word == "movetime") iss >> movetimeMs;
                            else if (word == "from") iss >> fromBudget;
                        }
                        if (budget <= 0) budget = UNLIMITED_MAX_BUDGET_PER_SIDE;
                        startSearch(runGoBudget, budget, movetimeMs,
                                                     std::max(1, fromBudget), session);
                    }
                }
            }
        } else if (cmd == "go") {
            std::string first;
            iss >> first;
            stopSearch();  // an toàn: nếu lượt trước còn dở thì dừng trước khi bắt đầu lượt mới
            if (first == "positional") {
                std::string word;
                int depth = AI_POSITIONAL_MAX_DEPTH;
                long long movetimeMs = 0;
                while (iss >> word) {
                    if (word == "depth") iss >> depth;
                    else if (word == "movetime") iss >> movetimeMs;
                }
                startSearch(runGoPositional, depth, movetimeMs);
            } else if (first == "budgets") {
                std::string word;
                int redBudget = 0, blackBudget = 0;
                long long movetimeMs = 0;
                while (iss >> word) {
                    if (word == "red") iss >> redBudget;
                    else if (word == "black") iss >> blackBudget;
                    else if (word == "movetime") iss >> movetimeMs;
                }
                startSearch(runGoBudgetPair, redBudget, blackBudget, movetimeMs, nullptr);
            } else if (first == "drawline") {
                std::string word;
                int redBudget = 0, blackBudget = 0;
                while (iss >> word) {
                    if (word == "red") iss >> redBudget;
                    else if (word == "black") iss >> blackBudget;
                }
                startSearch(runGoDrawLine, redBudget, blackBudget);
            } else {
                int budget = 0;
                long long movetimeMs = 0;
                int fromBudget = 1;
                if (first == "budget") iss >> budget;
                std::string word;
                while (iss >> word) {
                    if (word == "budget") iss >> budget;
                    else if (word == "movetime") iss >> movetimeMs;
                    else if (word == "from") iss >> fromBudget;
                }
                if (budget <= 0) budget = UNLIMITED_MAX_BUDGET_PER_SIDE;
                if (fromBudget < 1) fromBudget = 1;
                startSearch(runGoBudget, budget, movetimeMs, fromBudget, nullptr);
            }
        } else if (cmd == "stop") {
            stopSearch();
        } else if (cmd == "quit") {
            stopSearch();
            return false;
        }
        return true;
}

void initializeEngine() {
    static bool initialized = false;
    if (initialized) return;
    initZobrist();
    initEvalTables();
    initialized = true;
}

#ifdef __EMSCRIPTEN__
extern "C" EMSCRIPTEN_KEEPALIVE void bruteforce_command(const char* command) {
    if (!command || !*command) return;
    initializeEngine();
    try { executeCommandLine(command); }
    catch (const std::exception& error) {
        sendLine(std::string("info string ERROR: ") + error.what());
        sendLine("bestmove (none)");
    }
}

int main() {
    // Browser calls bruteforce_command(). Keep the runtime alive between commands.
    initializeEngine();
    return 0;
}
#else
int main() {
    initializeEngine();
    std::string line;
    while (std::getline(std::cin, line)) {
        try { if (!executeCommandLine(line)) break; }
        catch (const std::exception& error) {
            sendLine(std::string("info string ERROR: ") + error.what());
            sendLine("bestmove (none)");
        }
    }
    stopSearch();
    return 0;
}
#endif
