// Tìm chiếu bí đa luồng: chia nước gốc theo QUÂN cho nhiều luồng (xem searchMateRootByPiece).
// Option: Threads (0 = tự động = số nhân CPU, mặc định 1), SplitMode (dynamic|pieces|moves),
// ShareAlpha (true|false), WorkSteal (true|false). Sau mỗi lượt "go budget"/"go budgets" có thêm
// dòng "info string split ..." báo thống kê từng luồng.
//
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

#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00   // cần PowerCreateRequest / PowerRequestExecutionRequired (Windows 8+)
#endif
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <io.h>
#else
#include <csignal>
#include <fcntl.h>
#include <unistd.h>
#endif

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
#include <deque>
#include <unordered_set>
#include <unordered_map>
#include <atomic>
#include <chrono>
#include <mutex>
#include <memory>
#include <unordered_map>
#include <functional>
#include <stdexcept>
#include <filesystem>
#include <fstream>
#include <cstring>
#include <cstdio>
#include <ctime>

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
// Luật mở rộng tuỳ chọn "cản rồi bị ăn mà vẫn chiếu" — khớp checkStreakBonusRuleOn của app. Tắt mặc
// định, app báo qua option CheckStreak_BonusRule trước mỗi lượt "go" giống hệt cách báo
// CheckStreak_RestrictedColor/Limit.
bool g_checkStreakBonusRuleOn = false;
// Số luồng dùng cho nhánh tìm chiếu bí. Khác engine gốc (khoá cứng về 1), ở đây setoption
// Threads được tôn trọng: 0 hoặc "auto" = số nhân CPU của máy, còn lại kẹp trong [1, 64].
int g_threads = 1;
const int g_hwThreads = std::max(1u, std::thread::hardware_concurrency());

// Cách gom các nước gốc thành phần việc cho từng luồng:
//   Pieces: chia ĐỀU THEO SỐ QUÂN (quân thứ j trong thứ tự ưu tiên về luồng j mod T) — đúng ý tưởng
//           "8 quân / 4 luồng = mỗi luồng 2 quân", không quan tâm quân đó có bao nhiêu nước.
//   Moves : vẫn gom theo quân (một quân không bị tách giữa hai luồng) nhưng cân theo SỐ NƯỚC ĐI
//           (LPT: quân nhiều nước nhất giao trước cho luồng đang nhẹ nhất) để bớt lệch tải.
//   Dynamic: T quân ưu tiên cao nhất mỗi quân một luồng; các quân còn lại KHÔNG giao trước mà dồn vào một
//           kho chung (theo thứ tự ưu tiên) — luồng nào xong việc của mình thì lấy tiếp từ kho, ai rảnh
//           trước người đó làm. Đây là mặc định.
enum class SplitMode { Pieces, Moves, Dynamic };
SplitMode g_splitMode = SplitMode::Dynamic;
// true  = các luồng dùng chung alpha gốc (luồng nào tìm được mate/nước thoát thì các luồng kia siết cửa
//         sổ, nhánh không thể tốt hơn bị cắt ngay).
// false = mỗi luồng dò độc lập với alpha khởi điểm (kiểu "tách gốc thô" mà engine gốc đã đo là lỗ).
bool g_shareAlpha = true;
// true  = luồng nào xong hàng đợi của mình thì lấy trộm nước gốc chưa ai chạy từ cuối hàng đợi của luồng
//         còn nhiều việc nhất (cân bằng tải động, mức một nước gốc).
// false = mỗi luồng chỉ làm đúng phần được giao từ đầu (như bản trước).
bool g_workSteal = true;
bool g_keepAwake = true;   // giữ máy không tự ngủ trong lúc phân tích (Windows: ES_SYSTEM_REQUIRED; màn hình vẫn tắt được)
// [testphantich] Lưu tiến độ ra đĩa: thư mục (rỗng = tắt), chu kỳ tự lưu (giây, 0 = chỉ lưu khi dừng), cỡ bảng băm.
std::string g_dataDir;
int g_autosaveSec = 60;   // chu kỳ tự lưu (giây); thực tế tự giãn ra nếu một lần lưu quá lâu (xem runAnalyze)
std::atomic<long long> g_lastSaveMs{0};
std::atomic<int> g_curLevel{0};     // mức budget đang dò (cho dòng tiến độ)
std::atomic<bool> g_saving{false};  // đang ghi tiến độ ra đĩa (cho dòng tiến độ)
int g_progressMs = 1000;            // chu kỳ báo tiến độ trực tiếp (ms, 0 = tắt)   // thời gian lần lưu gần nhất, để tự giãn chu kỳ khi tệp lớn
int g_hashBits = 22;   // 2^22 ô = 64 MB mỗi luồng

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
    bool checkStreakBonusRuleOn = false;
    CsCode csRootRed = 0, csRootBlack = 0;
    bool ktcBudgetOn = false;
    MateSearchState state;
    std::vector<MateSearchState> workers;  // bể luồng phụ YBWC, ấm cùng nhịp với state (xem ensureWorkerPool)
    int activeBudget = 0;
    int completedBudget = 0;
    long long accumulatedMs = 0;
    int sliceCount = 0;
    // [testphantich] kết quả mate đã tìm thấy (lưu cùng tiến độ để chạy lại trả ngay)
    bool mateFound = false;
    int mateBudget = 0;
    int mateK = 0;            // đã mang dấu: dương = bên đi trước thắng
    int requestedBudget = 0;  // --budget của lần phân tích gần nhất (để biết "đã quét trọn" hay còn dở)
    std::vector<Move> matePv;
};

std::unordered_map<std::string, std::unique_ptr<SearchSession>> g_searchSessions;

// Bể trạng thái cho các luồng phụ (luồng 0 dùng chính `st`, luồng i>=1 dùng workers[i-1]). PHẢI sống NGOÀI
// một lượt gọi searchMateRootByPiece (ở SearchSession hoặc scope hàm runGoBudget*) và chỉ bị tt.clear()
// CÙNG LÚC với st.tt.clear(). Mỗi worker có TT riêng (16 MB) như engine gốc — không chia sẻ TT.
void ensureWorkerPool(std::vector<MateSearchState>& workers, const MateSearchState& templ) {
    size_t want = static_cast<size_t>(std::max(g_threads, 1) - 1);
    if (workers.size() < want) workers.resize(want);
    for (auto& w : workers) {
        if (!w.ttSized) { w.tt.resize(g_hashBits); w.ttSized = true; }
        w.restrictedSide = templ.restrictedSide;
        w.checkStreakLimit = templ.checkStreakLimit;
        w.checkStreakBonusRuleOn = templ.checkStreakBonusRuleOn;
        w.ktcBudgetOn = templ.ktcBudgetOn;
    }
}

void clearWorkerPool(std::vector<MateSearchState>& workers) {
    for (auto& w : workers) { w.tt.clear(); w.mateWitness.clear(); }
}

// Tổng nút ĐÃ QUÉT thật (luồng chính + mọi luồng phụ ấm) — dùng để báo cáo "info ... nodes N", THAY
// vì cộng dồn nodeCounter của worker vào st mỗi lần gọi (worker giờ SỐNG LÂU qua nhiều lượt gọi nên
// cộng dồn kiểu đó sẽ đếm trùng — xem searchMateRootByPiece).
i64 totalNodes(const MateSearchState& st, const std::vector<MateSearchState>& workers) {
    i64 n = st.nodeCounter;
    for (const auto& w : workers) n += w.nodeCounter;
    return n;
}

void captureSession(SearchSession& session) {
    session.board = g_board;
    session.sideToMove = g_sideToMove;
    session.history = g_history;
    session.restrictedSide = g_restrictedSide;
    session.checkStreakLimit = g_checkStreakLimit;
    session.checkStreakBonusRuleOn = g_checkStreakBonusRuleOn;
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
    g_checkStreakBonusRuleOn = session.checkStreakBonusRuleOn;
    g_csRootRed = session.csRootRed;
    g_csRootBlack = session.csRootBlack;
    g_ktcBudgetOn = session.ktcBudgetOn;
}

// ===================== Chia nước gốc THEO QUÂN =====================
// Ý tưởng: bên đi trước có P quân còn nước đi hợp lệ, máy có T luồng. Mỗi quân là một "gói việc" gồm mọi
// nước đi của quân đó ở gốc. P <= T: mỗi quân một luồng (chỉ dùng P luồng). P > T: các quân được chia
// đều cho T luồng. Mỗi luồng đào sâu toàn bộ cây con của các nước đi đầu tiên thuộc gói của mình.

struct SplitThreadStat {
    i64 nodes = 0;
    double busyMs = 0;
    int pieces = 0;       // số quân được giao ban đầu
    int moves = 0;        // số nước gốc được giao ban đầu
    int done = 0;         // số nước gốc thực sự đã dò (cộng dồn qua các lượt dò)
    int stolen = 0;       // trong đó bao nhiêu nước lấy từ hàng đợi của luồng khác
    int pooled = 0;       // bao nhiêu nước lấy từ kho chung (chế độ Dynamic)
    std::string squares;  // ô xuất phát của các quân được giao, ví dụ "b2,h2"
};

struct SplitStats {
    std::vector<SplitThreadStat> threads;
    int parallelProbes = 0;
    int serialProbes = 0;
    double parallelWallMs = 0;
    int pieceCount = 0;
    void reset() { *this = SplitStats{}; }
} g_splitStats;

struct RootSplit {
    std::vector<std::vector<size_t>> perThread;  // chỉ số nước gốc (trong rootMoves) giao cho từng luồng, theo thứ tự ưu tiên gốc
    std::vector<size_t> shared;                  // chế độ Dynamic: nước gốc trong kho chung, theo thứ tự ưu tiên gốc
    std::vector<std::string> squares;            // ô quân được giao cho từng luồng
    std::vector<int> pieces;                     // số quân của từng luồng
    int pieceCount = 0;
};

RootSplit splitRootByPiece(const std::vector<Move>& rootMoves, int threads, SplitMode mode) {
    RootSplit out;
    std::vector<int> pieceSquares;                   // thứ tự quân = thứ tự xuất hiện đầu tiên trong rootMoves
    std::vector<std::vector<size_t>> pieceMoves;     // chỉ số nước gốc của từng quân
    for (size_t i = 0; i < rootMoves.size(); ++i) {
        int sq = squareIndex(rootMoves[i].from);
        size_t k = 0;
        while (k < pieceSquares.size() && pieceSquares[k] != sq) ++k;
        if (k == pieceSquares.size()) { pieceSquares.push_back(sq); pieceMoves.emplace_back(); }
        pieceMoves[k].push_back(i);
    }
    out.pieceCount = static_cast<int>(pieceSquares.size());
    int T = std::max(1, std::min(threads, out.pieceCount));

    std::vector<std::vector<size_t>> owned(static_cast<size_t>(T));   // chỉ số quân của từng luồng
    std::vector<size_t> pooledPieces;  // chế độ Dynamic: quân đưa vào kho chung
    if (mode == SplitMode::Pieces) {
        for (size_t k = 0; k < pieceSquares.size(); ++k) owned[k % static_cast<size_t>(T)].push_back(k);
    } else if (mode == SplitMode::Dynamic) {
        for (size_t k = 0; k < pieceSquares.size(); ++k) {
            if (k < static_cast<size_t>(T)) owned[k].push_back(k); else pooledPieces.push_back(k);
        }
    } else {
        std::vector<size_t> order(pieceSquares.size());
        for (size_t k = 0; k < order.size(); ++k) order[k] = k;
        std::stable_sort(order.begin(), order.end(), [&](size_t x, size_t y) {
            return pieceMoves[x].size() > pieceMoves[y].size();
        });
        std::vector<size_t> load(static_cast<size_t>(T), 0);
        for (size_t k : order) {
            size_t t = static_cast<size_t>(std::min_element(load.begin(), load.end()) - load.begin());
            owned[t].push_back(k);
            load[t] += pieceMoves[k].size();
        }
    }

    out.perThread.resize(static_cast<size_t>(T));
    out.squares.resize(static_cast<size_t>(T));
    out.pieces.resize(static_cast<size_t>(T));
    for (size_t t = 0; t < owned.size(); ++t) {
        for (size_t k : owned[t]) {
            out.perThread[t].insert(out.perThread[t].end(), pieceMoves[k].begin(), pieceMoves[k].end());
            const Square sq{pieceSquares[k] / BOARD_WIDTH, pieceSquares[k] % BOARD_WIDTH};
            if (!out.squares[t].empty()) out.squares[t] += ',';
            out.squares[t] += squareToUci(sq);
        }
        std::sort(out.perThread[t].begin(), out.perThread[t].end());
        out.pieces[t] = static_cast<int>(owned[t].size());
    }
    for (size_t k : pooledPieces) out.shared.insert(out.shared.end(), pieceMoves[k].begin(), pieceMoves[k].end());
    std::sort(out.shared.begin(), out.shared.end());
    return out;
}

// Hàng đợi nước gốc của một luồng. Chủ nhân lấy từ ĐẦU (nước ưu tiên cao nhất trước); luồng rảnh "lấy
// trộm" từ CUỐI hàng đợi của luồng còn nhiều việc nhất (nước ưu tiên thấp nhất, chủ nhân sẽ tới sau
// cùng). Khoá mutex chỉ ở mức một nước gốc — mỗi nước là cả một cây tìm kiếm nên chi phí khoá không đáng kể.
struct RootWorkQueue {
    std::mutex m;
    std::deque<size_t> d;
};

SearchResult searchMateRootByPiece(Board& board, Color color, int redBudget, int blackBudget,
                                   i32 alpha, i32 beta, i32 h1, i32 h2, CsCode csRed, CsCode csBlack,
                                   MateSearchState& st, std::vector<MateSearchState>& workers,
                                   int requestedThreads) {
    auto singleThreaded = [&]() -> SearchResult {
        ++g_splitStats.serialProbes;
        SearchResult result = negamaxForcedMateGen(board, color, redBudget, blackBudget, 0, alpha, beta,
                                                    h1, h2, csRed, csBlack, st);
        if (result.score > MATE_THRESHOLD || result.score < -MATE_THRESHOLD) {
            std::vector<Move> witness = rebuildMateWitnessLine(board, color, redBudget, blackBudget,
                                                                csRed, csBlack, st);
            if (!witness.empty()) result.line = std::move(witness);
        }
        return result;
    };

    if (requestedThreads <= 1 || std::min(redBudget, blackBudget) <= 2) return singleThreaded();

    std::vector<Move> rootMoves = forcedMateRootMoves(board, color, st);
    if (rootMoves.size() < 2) return singleThreaded();
    int maxThreads = std::min(requestedThreads, static_cast<int>(workers.size()) + 1);
    RootSplit split = splitRootByPiece(rootMoves, maxThreads, g_splitMode);
    const int T = static_cast<int>(split.perThread.size());
    if (T <= 1) return singleThreaded();

    RootWorkQueue sharedQueue;
    sharedQueue.d.assign(split.shared.begin(), split.shared.end());
    std::vector<RootWorkQueue> queues(static_cast<size_t>(T));
    for (int i = 0; i < T; ++i)
        queues[static_cast<size_t>(i)].d.assign(split.perThread[static_cast<size_t>(i)].begin(),
                                                split.perThread[static_cast<size_t>(i)].end());

    // Lấy việc tiếp theo cho luồng `me`: ưu tiên hàng đợi của mình, hết thì (nếu bật) lấy trộm.
    auto take = [&](int me, size_t& idx, bool& stolen, bool& pooled) -> bool {
        pooled = false;
        {
            RootWorkQueue& own = queues[static_cast<size_t>(me)];
            std::lock_guard<std::mutex> lock(own.m);
            if (!own.d.empty()) { idx = own.d.front(); own.d.pop_front(); stolen = false; return true; }
        }
        {   // hết việc riêng: lấy tiếp từ kho chung (nước ưu tiên cao nhất còn lại)
            std::lock_guard<std::mutex> lock(sharedQueue.m);
            if (!sharedQueue.d.empty()) {
                idx = sharedQueue.d.front(); sharedQueue.d.pop_front();
                stolen = false; pooled = true; return true;
            }
        }
        if (!g_workSteal) return false;
        for (;;) {
            int victim = -1;
            size_t most = 0;
            for (int j = 0; j < T; ++j) {
                if (j == me) continue;
                std::lock_guard<std::mutex> lock(queues[static_cast<size_t>(j)].m);
                if (queues[static_cast<size_t>(j)].d.size() > most) { most = queues[static_cast<size_t>(j)].d.size(); victim = j; }
            }
            if (victim < 0) return false;  // không còn ai có việc dư
            RootWorkQueue& q = queues[static_cast<size_t>(victim)];
            std::lock_guard<std::mutex> lock(q.m);
            if (q.d.empty()) continue;      // bị luồng khác lấy mất giữa chừng, tìm lại
            idx = q.d.back(); q.d.pop_back(); stolen = true; return true;
        }
    };

    struct Candidate { SearchResult result; size_t idx = 0; bool valid = false; };
    std::atomic<i32> shared{alpha};
    std::vector<Candidate> cands(static_cast<size_t>(T));
    std::vector<double> busyMs(static_cast<size_t>(T), 0.0);
    std::vector<i64> nodeDelta(static_cast<size_t>(T), 0);
    std::vector<int> doneCount(static_cast<size_t>(T), 0), stolenCount(static_cast<size_t>(T), 0), pooledCount(static_cast<size_t>(T), 0);
    auto stateOf = [&](int i) -> MateSearchState& {
        return i == 0 ? st : workers[static_cast<size_t>(i - 1)];
    };

    auto run = [&](int i, Board& localBoard) {
        MateSearchState& local = stateOf(i);
        auto t0 = SearchClock::now();
        i64 n0 = local.nodeCounter;
        local.sharedAlpha = g_shareAlpha ? &shared : nullptr;
        Candidate& mine = cands[static_cast<size_t>(i)];
        size_t idx = 0;
        bool stolen = false, pooled = false;
        while (!local.isCancelled() && !local.timeUp() && take(i, idx, stolen, pooled)) {
            i32 a = alpha;
            if (mine.valid && mine.result.score > a) a = mine.result.score;  // alpha cục bộ tốt nhất của luồng này
            if (a >= beta) break;
            std::vector<Move> one{rootMoves[idx]};
            bool exact = false;
            SearchResult cur = negamaxForcedMateRootSubsetGen(localBoard, color, redBudget, blackBudget,
                one, a, beta, h1, h2, csRed, csBlack, local, &exact);
            if (local.isCancelled() || local.timeUp()) break;
            ++doneCount[static_cast<size_t>(i)];
            if (stolen) ++stolenCount[static_cast<size_t>(i)];
            if (pooled) ++pooledCount[static_cast<size_t>(i)];
            if (exact && (!mine.valid || cur.score > mine.result.score
                          || (cur.score == mine.result.score && idx < mine.idx))) {
                mine.result = std::move(cur); mine.idx = idx; mine.valid = true;
            }
        }
        local.sharedAlpha = nullptr;
        nodeDelta[static_cast<size_t>(i)] = local.nodeCounter - n0;
        busyMs[static_cast<size_t>(i)] = std::chrono::duration<double, std::milli>(
            SearchClock::now() - t0).count();
    };

    auto wall0 = SearchClock::now();
    std::vector<std::thread> pool;
    pool.reserve(static_cast<size_t>(T - 1));
    for (int i = 1; i < T; ++i) {
        MateSearchState& local = stateOf(i);
        local.cancelled = st.cancelled;
        local.deadline = st.deadline;
        local.ktcBudgetOn = st.ktcBudgetOn;
        local.ktcExemptColor = st.ktcExemptColor;
        // Sao chép bàn cờ TRƯỚC khi luồng 0 bắt đầu đi/hoàn nước trên `board` — nếu để luồng phụ tự sao
        // chép bên trong lambda thì có race: luồng 0 đã đổi `board` giữa chừng nên bản sao bị hỏng.
        pool.emplace_back([&, i, localBoard = board]() mutable {
            run(i, localBoard);
        });
    }
    run(0, board);  // luồng gọi hàm cũng làm việc, không đứng chờ
    for (auto& t : pool) t.join();
    double wallMs = std::chrono::duration<double, std::milli>(SearchClock::now() - wall0).count();

    ++g_splitStats.parallelProbes;
    g_splitStats.parallelWallMs += wallMs;
    g_splitStats.pieceCount = split.pieceCount;
    if (g_splitStats.threads.size() < static_cast<size_t>(T)) g_splitStats.threads.resize(static_cast<size_t>(T));
    for (int i = 0; i < T; ++i) {
        SplitThreadStat& s = g_splitStats.threads[static_cast<size_t>(i)];
        s.nodes += nodeDelta[static_cast<size_t>(i)];
        s.busyMs += busyMs[static_cast<size_t>(i)];
        s.done += doneCount[static_cast<size_t>(i)];
        s.stolen += stolenCount[static_cast<size_t>(i)];
        s.pooled += pooledCount[static_cast<size_t>(i)];
        s.pieces = split.pieces[static_cast<size_t>(i)];
        s.moves = static_cast<int>(split.perThread[static_cast<size_t>(i)].size());
        s.squares = split.squares[static_cast<size_t>(i)];
    }

    // Gộp: chỉ xét ứng viên "chính xác" (xem negamaxForcedMateRootSubsetGen); điểm cao nhất thắng, hoà
    // điểm thì lấy nước đứng trước trong thứ tự ưu tiên gốc.
    int bestThread = -1;
    for (int i = 0; i < T; ++i) {
        const Candidate& c = cands[static_cast<size_t>(i)];
        if (!c.valid) continue;
        if (bestThread < 0) { bestThread = i; continue; }
        const Candidate& b = cands[static_cast<size_t>(bestThread)];
        if (c.result.score > b.result.score || (c.result.score == b.result.score && c.idx < b.idx)) bestThread = i;
    }
    if (bestThread < 0) {
        // Không nước nào vượt alpha: ở cửa sổ "thắng" đó là kết quả bình thường (không có thắng ép).
        if (st.isCancelled() || st.timeUp()) return {0, {}};
        if (alpha > -MATE_THRESHOLD) return {alpha, {}};
        return singleThreaded();  // an toàn: tránh trả -MATE_SCORE bị hiểu nhầm là "bị ép thua"
    }
    SearchResult best = cands[static_cast<size_t>(bestThread)].result;
    if (best.score > MATE_THRESHOLD || best.score < -MATE_THRESHOLD) {
        Board scratch = board;
        std::vector<Move> witness = rebuildMateWitnessLine(scratch, color, redBudget, blackBudget,
                                                            csRed, csBlack, stateOf(bestThread));
        if (!witness.empty()) best.line = std::move(witness);
    }
    return best;
}

void emitSplitStats() {
    const SplitStats& s = g_splitStats;
    int T = static_cast<int>(s.threads.size());
    double busy = 0;
    for (const auto& t : s.threads) busy += t.busyMs;
    int util = (T > 0 && s.parallelWallMs > 0) ? static_cast<int>(100.0 * busy / (T * s.parallelWallMs) + 0.5) : 0;
    std::ostringstream head;
    head << "info string split mode=" << (g_splitMode == SplitMode::Pieces ? "pieces" : g_splitMode == SplitMode::Moves ? "moves" : "dynamic")
         << " share=" << (g_shareAlpha ? 1 : 0) << " steal=" << (g_workSteal ? 1 : 0)
         << " requested=" << g_threads << " hw=" << g_hwThreads
         << " used=" << T << " pieces=" << s.pieceCount << " parallel=" << s.parallelProbes
         << " serial=" << s.serialProbes << " wallMs=" << static_cast<long long>(s.parallelWallMs)
         << " utilPct=" << util;
    sendLine(head.str());
    for (int i = 0; i < T; ++i) {
        const SplitThreadStat& t = s.threads[static_cast<size_t>(i)];
        std::ostringstream line;
        line << "info string split thread " << i << " pieces=" << t.pieces << " moves=" << t.moves
             << " done=" << t.done << " stolen=" << t.stolen << " pooled=" << t.pooled
             << " nodes=" << t.nodes << " busyMs=" << static_cast<long long>(t.busyMs)
             << " squares=" << t.squares;
        sendLine(line.str());
    }
}

ProbeResult probeForcedMate(Board& board, Color color, int redBudget, int blackBudget,
                            CsCode csRed, CsCode csBlack, MateSearchState& st,
                            std::vector<MateSearchState>& workers, int threads) {
    HashPair hp = hashBoardPair(board);
    Color savedExempt = st.ktcExemptColor;
    Color opp = otherColor(color);

    int winRed = redBudget, winBlack = blackBudget;
    ktcSearchBudgets(color, redBudget, blackBudget, st.ktcBudgetOn, winRed, winBlack);
    st.ktcExemptColor = color;
    SearchResult win = searchMateRootByPiece(board, color, winRed, winBlack, MATE_THRESHOLD, MATE_SCORE,
                                                hp.h1, hp.h2, csRed, csBlack, st, workers, threads);
    if (win.score > MATE_THRESHOLD) {
        st.ktcExemptColor = savedExempt;
        return {true, win.score, win.line};
    }

    int lossRed = redBudget, lossBlack = blackBudget;
    ktcSearchBudgets(opp, redBudget, blackBudget, st.ktcBudgetOn, lossRed, lossBlack);
    st.ktcExemptColor = opp;
    SearchResult loss = searchMateRootByPiece(board, color, lossRed, lossBlack, -MATE_SCORE, -MATE_THRESHOLD,
                                                 hp.h1, hp.h2, csRed, csBlack, st, workers, threads);
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
    // Pha thế trận (Phase 2 "AI tự chơi") CHƯA được đổi sang YBWC như searchMateRootParallel ở trên:
    // positionalRoot() không lộ alpha/beta ra ngoài (xem positional.h) nên chưa có chỗ để chia sẻ
    // alpha giữa các luồng, và bản tách-gốc-thô dưới đây nhiều khả năng lỗ giống hệt kiểu đã đo được
    // ở nhánh chiếu bí (chưa đo thật cho nhánh này). Khoá cứng về 1 luồng ở đây cho tới khi
    // positionalRoot có bản lộ alpha/beta để làm YBWC tương tự — KHÔNG xoá code tách-gốc bên dưới để
    // dễ hoàn thiện sau.
    requestedThreads = 1;
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

// ===================== [testphantich] Lưu / nạp tiến độ phân tích =====================
// Mục tiêu: dừng giữa chừng (stop, hết giờ, tắt máy) rồi chạy lại vẫn tiếp tục từ chỗ đã dò, không làm lại từ đầu.
// Cây đệ quy đang dò dở KHÔNG lưu được (không serialize được stack), nên đây là "warm restart" như SearchSession:
// lưu (1) mức budget đã quét TRỌN VẸN (không dò lại), (2) bảng chuyển vị + witness của mức đang dở (dò lại mức đó
// sẽ tận dụng lại phần đã chứng minh), (3) kết quả mate nếu đã tìm thấy (chạy lại trả ngay).
// Mọi dữ liệu theo "bài toán" = thế cờ + bên đi + luật chiếu liên tục + ktc, đặt tên tệp theo băm của chúng.
namespace ck {

// Ép nội dung tệp xuống đĩa (FlushFileBuffers / fsync).
void flushFileToDisk(const std::filesystem::path& file) {
#ifdef _WIN32
    HANDLE h = CreateFileW(file.wstring().c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h != INVALID_HANDLE_VALUE) { FlushFileBuffers(h); CloseHandle(h); }
#else
    int fd = ::open(file.c_str(), O_RDWR);
    if (fd >= 0) { ::fsync(fd); ::close(fd); }
#endif
}
#ifndef _WIN32
void syncDirectory(const std::filesystem::path& dir) {
    int fd = ::open(dir.c_str(), O_RDONLY);
    if (fd >= 0) { ::fsync(fd); ::close(fd); }
}
#endif

constexpr char MAGIC[4] = {'B', 'F', 'C', 'K'};
constexpr uint32_t VERSION = 2;

template <typename T> void put(std::ostream& os, const T& v) { os.write(reinterpret_cast<const char*>(&v), sizeof v); }
template <typename T> bool get(std::istream& is, T& v) { is.read(reinterpret_cast<char*>(&v), sizeof v); return static_cast<bool>(is); }

// Mọi thứ làm hai lượt phân tích khác bài toán, thành một dãy byte cố định (cũng dùng để kiểm tra khi nạp).
std::vector<unsigned char> identityBytes(const SearchSession& s) {
    std::vector<unsigned char> out;
    out.reserve(BOARD_HEIGHT * BOARD_WIDTH * 2 + 32);
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            out.push_back(static_cast<unsigned char>(s.board[r][c].type));
            out.push_back(static_cast<unsigned char>(s.board[r][c].color));
        }
    out.push_back(static_cast<unsigned char>(s.sideToMove));
    out.push_back(static_cast<unsigned char>(s.restrictedSide));
    out.push_back(static_cast<unsigned char>(s.checkStreakLimit & 0xFF));
    out.push_back(static_cast<unsigned char>(s.checkStreakBonusRuleOn ? 1 : 0));
    out.push_back(static_cast<unsigned char>(s.ktcBudgetOn ? 1 : 0));
    for (CsCode code : {s.csRootRed, s.csRootBlack})
        for (int i = 0; i < 8; ++i) out.push_back(static_cast<unsigned char>((static_cast<uint64_t>(code) >> (8 * i)) & 0xFF));
    return out;
}

std::string keyOf(const SearchSession& s) {
    uint64_t h = 1469598103934665603ULL;  // FNV-1a 64 bit
    for (unsigned char b : identityBytes(s)) { h ^= b; h *= 1099511628211ULL; }
    char buf[20];
    std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(h));
    return buf;
}

// Tên tệp = chính FEN của thế (dấu "/" không được phép trong tên tệp nên đổi thành "_"), thêm " [luật]" nếu luật chiếu
// khác mặc định "Phân Tích" (bên đi sau chiếu tối đa 2 lần, không cản-ăn, không ktc). Ví dụ:
//   9_3k5_9_9_9_9_9_4KC3_7c1_8C w - - 0 1.bfck
//   9_3k5_9_9_9_9_9_4KC3_7c1_8C w - - 0 1 [both-3].bfck
std::string fileNameFor(const std::vector<unsigned char>& id) {
    Board b{};
    size_t pos = 0;
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            b[r][c].type = static_cast<PieceType>(id[pos++]);
            b[r][c].color = static_cast<Color>(id[pos++]);
        }
    const Color side = static_cast<Color>(id[pos++]);
    const int restricted = id[pos++] & 3;
    const int limit = id[pos++];
    const bool bonus = id[pos++] != 0;
    const bool ktc = id[pos++] != 0;
    uint64_t rootBytes = 1469598103934665603ULL;   // FNV-1a của 16 byte trạng thái chiếu gốc
    bool roots = false;
    for (size_t i = pos; i < id.size(); ++i) {
        if (id[i]) roots = true;
        rootBytes = (rootBytes ^ id[i]) * 1099511628211ULL;
    }
    std::string name = boardToXiangqiFen(b, side);
    for (char& ch : name) if (ch == '/') ch = '_';
    const bool analysis = (side == Color::Red && restricted == 2) || (side == Color::Black && restricted == 1);
    if (!(analysis && limit == 2 && !bonus && !ktc && !roots)) {
        static const char* names[4] = {"none", "red", "black", "both"};
        name += std::string(" [") + names[restricted] + "-" + std::to_string(limit) + (bonus ? "+bonus" : "") + (ktc ? "+ktc" : "");
        if (roots) {
            char hex[12];
            std::snprintf(hex, sizeof hex, "%08x", static_cast<unsigned>(rootBytes & 0xFFFFFFFFu));
            name += std::string("+roots") + hex;
        }
        name += "]";
    }
    return name + ".bfck";
}

std::filesystem::path pathFor(const SearchSession& s) {
    return std::filesystem::u8path(g_dataDir) / fileNameFor(identityBytes(s));
}

void putVec(std::ostream& os, const std::vector<i32>& v) {
    put(os, static_cast<uint32_t>(v.size()));
    if (!v.empty()) os.write(reinterpret_cast<const char*>(v.data()), static_cast<std::streamsize>(v.size() * sizeof(i32)));
}
bool getVec(std::istream& is, std::vector<i32>& v, size_t expected) {
    uint32_t n = 0;
    if (!get(is, n) || n != expected) return false;
    v.resize(n);
    if (n) is.read(reinterpret_cast<char*>(v.data()), static_cast<std::streamsize>(n * sizeof(i32)));
    return static_cast<bool>(is);
}

void writeState(std::ostream& os, const MateSearchState& st) {
    put(os, static_cast<int64_t>(st.nodeCounter));
    st.tt.writeTo(os);
    putVec(os, st.mateHistoryScores);
    putVec(os, st.mateKillerA);
    putVec(os, st.mateKillerB);
    put(os, static_cast<uint64_t>(st.mateWitness.size()));
    for (const auto& kv : st.mateWitness) {
        const MateWitnessKey& k = kv.first;
        put(os, k.h1); put(os, k.h2); put(os, static_cast<i32>(k.redBudget)); put(os, static_cast<i32>(k.blackBudget));
        put(os, static_cast<int64_t>(k.csRed)); put(os, static_cast<int64_t>(k.csBlack));
        put(os, static_cast<uint8_t>(k.isRed ? 1 : 0)); put(os, kv.second);
    }
}

bool readState(std::istream& is, MateSearchState& st) {
    int64_t nodes = 0;
    if (!get(is, nodes) || nodes < 0) return false;
    if (!st.tt.readFrom(is)) return false;
    if (!getVec(is, st.mateHistoryScores, st.mateHistoryScores.size())) return false;
    if (!getVec(is, st.mateKillerA, st.mateKillerA.size())) return false;
    if (!getVec(is, st.mateKillerB, st.mateKillerB.size())) return false;
    uint64_t witnesses = 0;
    if (!get(is, witnesses) || witnesses > 10'000'000ULL) return false;
    st.mateWitness.clear();
    for (uint64_t i = 0; i < witnesses; ++i) {
        MateWitnessKey k{};
        i32 rb = 0, bb = 0, value = 0;
        int64_t csr = 0, csb = 0;
        uint8_t isRed = 0;
        if (!get(is, k.h1) || !get(is, k.h2) || !get(is, rb) || !get(is, bb) || !get(is, csr) || !get(is, csb)
            || !get(is, isRed) || !get(is, value)) return false;
        k.redBudget = rb; k.blackBudget = bb; k.csRed = csr; k.csBlack = csb; k.isRed = isRed != 0;
        st.mateWitness[k] = value;
    }
    st.nodeCounter = nodes;
    st.ttSized = true;
    return true;
}

struct Header {
    std::vector<unsigned char> identity;
    int completed = 0, active = 0, sliceCount = 0, mateBudget = 0, mateK = 0, requested = 0;
    int64_t accumulatedMs = 0;
    bool mateFound = false;
    std::vector<Move> matePv;
    uint32_t states = 0;
};

bool readHeader(std::istream& is, Header& h) {
    char magic[4];
    uint32_t version = 0, idLen = 0;
    is.read(magic, 4);
    if (!is || std::memcmp(magic, MAGIC, 4) != 0) return false;
    if (!get(is, version) || version != VERSION) return false;
    if (!get(is, idLen) || idLen > 4096) return false;
    h.identity.resize(idLen);
    if (idLen) is.read(reinterpret_cast<char*>(h.identity.data()), idLen);
    uint8_t mate = 0;
    uint32_t pvCount = 0;
    if (!is || !get(is, h.completed) || !get(is, h.active) || !get(is, h.accumulatedMs) || !get(is, h.sliceCount)
        || !get(is, h.requested) || !get(is, mate) || !get(is, h.mateBudget) || !get(is, h.mateK) || !get(is, pvCount) || pvCount > 1024) return false;
    h.mateFound = mate != 0;
    for (uint32_t i = 0; i < pvCount; ++i) {
        i32 v[4];
        for (int j = 0; j < 4; ++j) if (!get(is, v[j])) return false;
        Move m; m.from = {v[0], v[1]}; m.to = {v[2], v[3]};
        h.matePv.push_back(m);
    }
    return get(is, h.states) && h.states >= 1 && h.states <= 64;
}

// Tệp cũ đặt tên bằng băm 16 chữ số hex: đổi sang tên theo FEN (kèm tệp .log nếu có). Rất nhanh (chỉ đổi tên).
void migrateLegacy() {
    if (g_dataDir.empty()) return;
    namespace fs = std::filesystem;
    std::error_code ec;
    if (!fs::exists(fs::u8path(g_dataDir), ec)) return;
    std::vector<fs::path> legacy;
    for (const auto& entry : fs::directory_iterator(fs::u8path(g_dataDir), ec)) {
        const fs::path& p = entry.path();
        const std::string stem = p.stem().string();
        if (p.extension() != ".bfck" || stem.size() != 16) continue;
        if (stem.find_first_not_of("0123456789abcdef") != std::string::npos) continue;
        legacy.push_back(p);
    }
    for (const fs::path& p : legacy) {
        Header h;
        {
            std::ifstream is(p, std::ios::binary);
            if (!readHeader(is, h) || h.identity.size() < BOARD_HEIGHT * BOARD_WIDTH * 2 + 5) continue;
        }
        const fs::path target = p.parent_path() / fileNameFor(h.identity);
        if (fs::exists(target, ec)) continue;   // đã có tệp theo FEN: giữ nguyên tệp cũ, không đè
        fs::rename(p, target, ec);
        if (ec) continue;
        const fs::path oldLog = p.parent_path() / (p.stem().string() + ".log");
        const fs::path newLog = p.parent_path() / (target.stem().string() + ".log");
        if (fs::exists(oldLog, ec) && !fs::exists(newLog, ec)) fs::rename(oldLog, newLog, ec);
        sendLine("info string checkpoint migrated " + p.filename().string() + " -> " + target.filename().string());
    }
}

// Ghi nguyên tử: viết tệp tạm rồi đổi tên, nên tắt máy giữa chừng không để lại tệp hỏng. Trả mô tả kết quả.
std::string save(const SearchSession& s) {
    if (g_dataDir.empty()) return "";
    g_saving = true;
    struct SavingReset { ~SavingReset() { g_saving = false; } } savingReset;
    namespace fs = std::filesystem;
    try {
        const fs::path path = pathFor(s);
        fs::create_directories(path.parent_path());
        const fs::path tmp = path.string() + ".tmp";
        const auto saveStart = SearchClock::now();
        {
            std::ofstream os(tmp, std::ios::binary | std::ios::trunc);
            if (!os) return "info string checkpoint ERROR cannot open " + tmp.string();
            os.write(MAGIC, 4);
            put(os, VERSION);
            const std::vector<unsigned char> id = identityBytes(s);
            put(os, static_cast<uint32_t>(id.size()));
            os.write(reinterpret_cast<const char*>(id.data()), static_cast<std::streamsize>(id.size()));
            put(os, static_cast<i32>(s.completedBudget));
            put(os, static_cast<i32>(s.activeBudget));
            put(os, static_cast<int64_t>(s.accumulatedMs));
            put(os, static_cast<i32>(s.sliceCount));
            put(os, static_cast<i32>(s.requestedBudget));
            put(os, static_cast<uint8_t>(s.mateFound ? 1 : 0));
            put(os, static_cast<i32>(s.mateBudget));
            put(os, static_cast<i32>(s.mateK));
            put(os, static_cast<uint32_t>(s.matePv.size()));
            for (const Move& m : s.matePv) { put(os, static_cast<i32>(m.from.row)); put(os, static_cast<i32>(m.from.col)); put(os, static_cast<i32>(m.to.row)); put(os, static_cast<i32>(m.to.col)); }
            put(os, static_cast<uint32_t>(1 + s.workers.size()));
            writeState(os, s.state);
            for (const MateSearchState& w : s.workers) writeState(os, w);
            os.write("END!", 4);
            os.flush();
            if (!os) { os.close(); std::error_code ec; fs::remove(tmp, ec); return "info string checkpoint ERROR write failed (disk full?)"; }
        }
        // Ép dữ liệu xuống đĩa TRƯỚC khi đổi tên: mất điện/ngắt nguồn giữa chừng thì hoặc còn tệp cũ nguyên vẹn,
        // hoặc có tệp mới đầy đủ — không bao giờ là tệp cụt chỉ nằm trong bộ nhớ đệm của hệ điều hành.
        flushFileToDisk(tmp);
        std::error_code ec;
#ifdef _WIN32
        if (!MoveFileExW(tmp.wstring().c_str(), path.wstring().c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            return "info string checkpoint ERROR rename failed code=" + std::to_string(GetLastError());
#else
        fs::rename(tmp, path, ec);
        if (ec) return "info string checkpoint ERROR rename: " + ec.message();
        syncDirectory(path.parent_path());
#endif
        g_lastSaveMs = static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(SearchClock::now() - saveStart).count());
        i64 nodesTotal = s.state.nodeCounter;
        for (const MateSearchState& w : s.workers) nodesTotal += w.nodeCounter;
        const long long bytesNow = static_cast<long long>(fs::file_size(path, ec));
        size_t ttUsed0 = s.state.tt.used();
        std::ostringstream line;
        line << "info string checkpoint saved file=" << path.filename().string() << " completed=" << s.completedBudget
             << " active=" << s.activeBudget << " mate=" << (s.mateFound ? 1 : 0) << " accumulatedMs=" << s.accumulatedMs
             << " threads=" << (1 + s.workers.size()) << " bytes=" << bytesNow << " nodes=" << nodesTotal
             << " saveMs=" << g_lastSaveMs.load();
        // Lịch sử lưu: mỗi lần lưu một dòng trong <mã>.log cạnh tệp tiến độ (để xem tốc độ, độ đầy bảng băm, thời gian lưu).
        try {
            std::ofstream log(path.string().substr(0, path.string().size() - 5) + ".log", std::ios::app);
            if (log) {
                const std::time_t now = std::time(nullptr);
                char stamp[32];
                std::strftime(stamp, sizeof stamp, "%Y-%m-%dT%H:%M:%S", std::localtime(&now));
                log << stamp << " completed=" << s.completedBudget << " active=" << s.activeBudget << " mate=" << (s.mateFound ? 1 : 0)
                    << " accumulatedMs=" << s.accumulatedMs << " nodes=" << nodesTotal << " bytes=" << bytesNow
                    << " saveMs=" << g_lastSaveMs.load() << " threads=" << (1 + s.workers.size())
                    << " ttBits=" << s.state.tt.bits() << " ttUsed0=" << ttUsed0 << " slices=" << s.sliceCount << '\n';
            }
        } catch (...) { /* lịch sử chỉ để tham khảo, không được làm hỏng lần lưu */ }
        return line.str();
    } catch (const std::exception& e) {
        return std::string("info string checkpoint ERROR ") + e.what();
    }
}

// Nạp vào `s` (đã captureSession nên có sẵn danh tính bài toán). Chỉ sửa `s` khi nạp THÀNH CÔNG toàn bộ.
// Trả mô tả để in ra; loaded=true nếu đã áp dụng.
std::string load(SearchSession& s, bool& loaded) {
    loaded = false;
    if (g_dataDir.empty()) return "";
    namespace fs = std::filesystem;
    migrateLegacy();
    try {
        const fs::path path = pathFor(s);
        if (!fs::exists(path)) return "info string checkpoint none file=" + path.filename().string();
        std::ifstream is(path, std::ios::binary);
        Header h;
        if (!readHeader(is, h)) return "info string checkpoint ignored reason=bad-header file=" + path.filename().string();
        if (h.identity != identityBytes(s)) return "info string checkpoint ignored reason=different-problem file=" + path.filename().string();
        std::vector<MateSearchState> states(h.states);
        for (uint32_t i = 0; i < h.states; ++i)
            if (!readState(is, states[i])) return "info string checkpoint ignored reason=corrupt-state file=" + path.filename().string();
        char tail[4];
        is.read(tail, 4);
        if (!is || std::memcmp(tail, "END!", 4) != 0) return "info string checkpoint ignored reason=truncated file=" + path.filename().string();
        s.completedBudget = h.completed;
        s.activeBudget = h.active;
        s.accumulatedMs = h.accumulatedMs;
        s.sliceCount = h.sliceCount;
        s.requestedBudget = h.requested;
        s.mateFound = h.mateFound;
        s.mateBudget = h.mateBudget;
        s.mateK = h.mateK;
        s.matePv = h.matePv;
        s.state = std::move(states[0]);
        s.workers.clear();
        for (uint32_t i = 1; i < h.states; ++i) s.workers.push_back(std::move(states[i]));
        loaded = true;
        std::ostringstream line;
        line << "info string checkpoint loaded file=" << path.filename().string() << " completed=" << s.completedBudget
             << " active=" << s.activeBudget << " mate=" << (s.mateFound ? 1 : 0) << " accumulatedMs=" << s.accumulatedMs
             << " threads=" << h.states << " ttBits=" << s.state.tt.bits() << " ttUsed=" << s.state.tt.used()
             << " nodes=" << totalNodes(s.state, s.workers);
        return line.str();
    } catch (const std::exception& e) {
        return std::string("info string checkpoint ignored reason=") + e.what();
    }
}

// "checkpoint list": mỗi tệp một dòng (đọc phần đầu, không nạp bảng băm).
void list() {
    namespace fs = std::filesystem;
    if (g_dataDir.empty()) { sendLine("info string checkpoint list ERROR no DataDir"); return; }
    migrateLegacy();
    int count = 0;
    std::error_code ec;
    if (fs::exists(fs::u8path(g_dataDir), ec)) {
        std::vector<fs::path> files;
        for (const auto& entry : fs::directory_iterator(fs::u8path(g_dataDir), ec))
            if (entry.path().extension() == ".bfck") files.push_back(entry.path());
        std::sort(files.begin(), files.end());
        for (const fs::path& p : files) {
            std::ifstream is(p, std::ios::binary);
            Header h;
            std::ostringstream line;
            line << "info string checkpoint item";
            if (!readHeader(is, h) || h.identity.size() < BOARD_HEIGHT * BOARD_WIDTH * 2 + 5) { sendLine(line.str() + " status=unreadable file=" + p.filename().string()); continue; }
            Board b{};
            size_t pos = 0;
            for (int r = 0; r < BOARD_HEIGHT; ++r)
                for (int c = 0; c < BOARD_WIDTH; ++c) {
                    b[r][c].type = static_cast<PieceType>(h.identity[pos++]);
                    b[r][c].color = static_cast<Color>(h.identity[pos++]);
                }
            const Color side = static_cast<Color>(h.identity[pos++]);
            std::string fen = boardToXiangqiFen(b, side);
            for (char& ch : fen) if (ch == ' ') ch = '_';
            bool roots = false;
            for (size_t i = pos + 4; i < h.identity.size(); ++i) if (h.identity[i]) roots = true;
            line << " fen=" << fen << " side=" << (side == Color::Red ? 'w' : 'b') << " restricted=" << static_cast<int>(h.identity[pos])
                 << " limit=" << static_cast<int>(h.identity[pos + 1]) << " bonus=" << static_cast<int>(h.identity[pos + 2])
                 << " ktc=" << static_cast<int>(h.identity[pos + 3]) << " roots=" << (roots ? 1 : 0) << " requested=" << h.requested
                 << " completed=" << h.completed << " active=" << h.active << " mate=" << (h.mateFound ? 1 : 0)
                 << " mateK=" << h.mateK << " accumulatedMs=" << h.accumulatedMs << " slices=" << h.sliceCount
                 << " bytes=" << fs::file_size(p, ec);
            if (!h.matePv.empty()) {
                line << " pv=";
                for (size_t i = 0; i < h.matePv.size(); ++i) line << (i ? "," : "") << moveToUci(h.matePv[i]);
            }
            line << " file=" << p.filename().string();   // file= luôn ở cuối (tên có dấu cách)
            sendLine(line.str());
            ++count;
        }
    }
    sendLine("info string checkpoint list count=" + std::to_string(count));
}

}  // namespace ck

// Đào sâu dần budget fromBudget..N — khớp cấu trúc nextDepth() trong runDeepeningAnalysisChunked
// (xiangqi-analyzer.html:3853-3903), thu gọn cho một luồng (chưa chia pool đa luồng). fromBudget=1
// là lượt "Bắt Đầu Phân Tích" bình thường; fromBudget>1 là "Tiếp Tục Phân Tích" — các mức
// 1..fromBudget-1 app đã biết CHẮC CHẮN không có thắng ép (đã quét cạn xong ở lượt "go" trước),
// nên bỏ qua, không quét lại — mọi giây mới xin thêm dồn thẳng cho mức tiếp theo trở đi.
// Báo tiến độ TRỰC TIẾP mỗi g_progressMs: mức đang dò, tổng số nút, nút/giây, thời gian đã dò — để màn hình không đứng.
// Đọc nodeCounter của các luồng không khoá (chỉ để hiển thị, sai lệch nhỏ không sao).
struct ProgressReporter {
    std::atomic<bool> stop{false};
    std::thread th;
    ProgressReporter(const MateSearchState& st, const std::vector<MateSearchState>& workers, long long baseMs, SearchClock::time_point t0) {
        if (g_progressMs <= 0) return;
        th = std::thread([this, &st, &workers, baseMs, t0] {
            i64 lastNodes = totalNodes(st, workers);
            auto lastT = SearchClock::now();
            while (!stop.load()) {
                for (int waited = 0; waited < g_progressMs && !stop.load(); waited += 50)
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                if (stop.load()) break;
                const i64 nodes = totalNodes(st, workers);
                const auto now = SearchClock::now();
                const double secs = std::chrono::duration<double>(now - lastT).count();
                const long long nps = secs > 0 ? static_cast<long long>(static_cast<double>(nodes - lastNodes) / secs) : 0;
                lastNodes = nodes;
                lastT = now;
                const long long elapsed = baseMs + std::chrono::duration_cast<std::chrono::milliseconds>(now - t0).count();
                std::ostringstream line;
                line << "info string progress level=" << g_curLevel.load() << " nodes=" << nodes << " nps=" << nps
                     << " elapsedMs=" << elapsed << " saving=" << (g_saving.load() ? 1 : 0);
                sendLine(line.str());
            }
        });
    }
    ~ProgressReporter() {
        stop = true;
        if (th.joinable()) th.join();
    }
};

// Kết quả một lượt dò (dùng khi gọi từ runAnalyze, không in dòng kết thúc).
struct GoResult {
    bool foundMate = false;
    ProbeResult mate;
    int done = 0;
    bool cancelled = false;
};

void runGoBudgetImpl(int maxBudget, long long movetimeMs, int fromBudget, SearchSession* session, GoResult* out) {
    if (maxBudget < 1 || maxBudget > UNLIMITED_MAX_BUDGET_PER_SIDE || fromBudget > maxBudget)
        throw std::invalid_argument("budget must be 1..60 and from <= budget");
    if (movetimeMs < 0 || movetimeMs > 86400000) throw std::invalid_argument("invalid movetime");
    auto t0 = SearchClock::now();
    auto deadline = (movetimeMs > 0)
        ? t0 + std::chrono::milliseconds(movetimeMs)
        : SearchClock::time_point::max();

    auto freshState = session ? nullptr : std::make_unique<MateSearchState>();
    MateSearchState& st = session ? session->state : *freshState;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.checkStreakBonusRuleOn = g_checkStreakBonusRuleOn;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    if (!st.ttSized) { st.tt.resize(g_hashBits); st.ttSized = true; }
    st.deadline = deadline;  // để một mức budget đang chạy dở tự dừng đúng hạn, không tràn qua giờ
                              // (đã thấy thật: xin movetime 3s nhưng chạy tới 15s — vòng lặp NGOÀI
                              // chỉ kiểm tra giờ GIỮA các mức, một mức chạy lâu vẫn không bị chặn).
    auto freshWorkers = session ? nullptr : std::make_unique<std::vector<MateSearchState>>();
    std::vector<MateSearchState>& workers = session ? session->workers : *freshWorkers;
    ensureWorkerPool(workers, st);

    g_splitStats.reset();
    const long long baseMs = session ? session->accumulatedMs : 0;   // thời gian đã dò ở các lần chạy trước
    std::unique_ptr<ProgressReporter> progress;
    if (out && session) progress = std::make_unique<ProgressReporter>(st, workers, baseMs, t0);   // chỉ ở chế độ "analyze"
    Board board = g_board;
    Color color = g_sideToMove;
    if (session) fromBudget = std::max(fromBudget, session->completedBudget + 1);
    int doneBudget = session ? session->completedBudget : (fromBudget > 1 ? fromBudget - 1 : 0);
    ProbeResult lastMate;
    bool foundMate = false;

    for (int budget = std::max(1, fromBudget); budget <= maxBudget; ++budget) {
        if (g_cancelled.load() || SearchClock::now() > deadline) break;
        g_curLevel = budget;

        if (!session || session->activeBudget != budget) {
            st.tt.clear();
            st.mateWitness.clear();
            clearWorkerPool(workers);
            if (session) session->activeBudget = budget;
        }
        Board scratch = board;
        ProbeResult res = probeForcedMate(scratch, color, budget, budget,
            g_csRootRed, g_csRootBlack, st, workers, g_threads);
        // Bị huỷ HOẶC hết giờ GIỮA mức budget này: res có thể bị cắt dở ở bất kỳ nhánh nào, không
        // còn là kết quả "đã quét cạn xong, chắc chắn" — Brute-force CAM KẾT chỉ báo cáo mức đã quét
        // TRỌN VẸN. Dừng ngay, giữ nguyên doneBudget/kết quả của mức TRƯỚC (nếu có) — khớp đúng
        // nguyên tắc "completedFully" đã áp cho runGoPositional bên dưới.
        if (g_cancelled.load() || st.timeUp()) break;

        doneBudget = budget;
        if (session) session->completedBudget = budget;
        if (session && !g_dataDir.empty()) {
            // Lưu NGAY khi một mức quét xong (kể cả khi vừa tìm thấy mate): kết quả quý nhất không được mất nếu
            // tiến trình bị tắt hay mất điện ngay sau đó. (Mức đang dở thì do tự lưu định kỳ giữ.)
            if (res.mate) {
                session->mateFound = true; session->mateBudget = budget;
                int kk = g_ktcBudgetOn ? budget : ((res.score > 0) ? (MATE_SCORE - res.score + 1) / 2 : (MATE_SCORE + res.score) / 2);
                session->mateK = (res.score > 0 ? kk : -kk); session->matePv = res.line;
            }
            session->accumulatedMs = baseMs + std::chrono::duration_cast<std::chrono::milliseconds>(SearchClock::now() - t0).count();
            const std::string levelSave = ck::save(*session);
            if (!levelSave.empty()) sendLine(levelSave);
        }
        long long elapsedMs = baseMs + std::chrono::duration_cast<std::chrono::milliseconds>(
            SearchClock::now() - t0).count();

        if (res.mate) {
            foundMate = true; lastMate = res;
            int k = g_ktcBudgetOn ? budget
                : ((res.score > 0) ? (MATE_SCORE - res.score + 1) / 2 : (MATE_SCORE + res.score) / 2);
            if (session) {
                session->mateFound = true; session->mateBudget = budget;
                session->mateK = (res.score > 0 ? k : -k); session->matePv = res.line;
            }
            std::ostringstream line;
            line << "info depth " << budget << " score mate " << (res.score > 0 ? k : -k)
                 << " nodes " << totalNodes(st, workers) << " time " << elapsedMs;
            sendLine(line.str() + formatPv(res.line));
            break;  // budget đầu tiên chứng minh được mate CHÍNH LÀ số nước tối thiểu — dừng ngay,
                    // khớp :2020-2045 (mateDepth tăng dần, gặp mate là chốt, không đào tiếp).
        } else {
            std::ostringstream line;
            line << "info depth " << budget << " score cp 0 nodes " << totalNodes(st, workers) << " time " << elapsedMs;
            sendLine(line.str());
        }
    }

    emitSplitStats();
    if (session) {
        session->accumulatedMs = baseMs + std::chrono::duration_cast<std::chrono::milliseconds>(
            SearchClock::now() - t0).count();
        session->sliceCount++;
        std::ostringstream progress;
        progress << "info string session warm accumulated " << session->accumulatedMs
                 << " slices " << session->sliceCount << " completed " << session->completedBudget;
        sendLine(progress.str());
    }

    if (out) {   // runAnalyze tự quyết định in kết thúc / lưu tiến độ
        out->foundMate = foundMate; out->mate = lastMate; out->done = doneBudget; out->cancelled = g_cancelled.load();
        return;
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
void runGoBudget(int maxBudget, long long movetimeMs, int fromBudget, SearchSession* session = nullptr) {
    runGoBudgetImpl(maxBudget, movetimeMs, fromBudget, session, nullptr);
}

// ===================== [testphantich] "analyze": phân tích có lưu / tiếp tục tiến độ =====================
// analyze budget <N> [movetime <ms>] [from <M>]
// Cùng thuật toán với "go budget" nhưng: (1) nạp tiến độ đã lưu của đúng bài toán này (nếu có) và bỏ qua các mức
// đã quét xong; (2) chia lượt dò thành các "lát" AutosaveSec giây — mỗi hết lát cuối lát, luồng dừng theo đúng
// cơ chế hết giờ vốn đã an toàn với bảng băm, tiến độ được ghi ra đĩa rồi dò tiếp ngay (không mất gì ngoài
// việc đi xuống lại cây, nhờ bảng băm ấm); (3) dừng bằng stop/hết giờ cũng lưu; (4) tìm được mate thì lưu kết quả,
// lần chạy sau trả ngay không dò lại.
// Giữ hệ thống không tự ngủ khi đang phân tích (chỉ Windows). Màn hình vẫn tắt được; hết phân tích thì trả lại như cũ.
struct KeepAwakeGuard {
    bool active = false;
#ifdef _WIN32
    HANDLE request = nullptr;   // yêu cầu nguồn kiểu "Power Request" (chuẩn cho máy dùng Modern/Connected Standby)
#endif
    KeepAwakeGuard() {
#ifdef _WIN32
        if (!g_keepAwake) return;
        // 1) PowerRequestExecutionRequired + SystemRequired: tiến trình có yêu cầu này được miễn bị Windows đóng băng
        //    (Desktop Activity Moderator) khi máy vào Modern/Connected Standby (tắt màn hình lúc nhàn rỗi). Chỉ dùng
        //    SetThreadExecutionState thì máy kiểu này VẪN có thể đóng băng tiến trình sau khi tắt màn hình.
        POWER_REQUEST_CONTEXT ctx;
        ZeroMemory(&ctx, sizeof ctx);
        ctx.Version = POWER_REQUEST_CONTEXT_VERSION;
        ctx.Flags = POWER_REQUEST_CONTEXT_SIMPLE_STRING;
        static wchar_t reason[] = L"Brute-force dang phan tich the co";
        ctx.Reason.SimpleReasonString = reason;
        request = PowerCreateRequest(&ctx);
        bool power = false;
        if (request && request != INVALID_HANDLE_VALUE) {
            power = PowerSetRequest(request, PowerRequestSystemRequired) != 0;
            power = (PowerSetRequest(request, PowerRequestExecutionRequired) != 0) || power;
        }
        // 2) Dự phòng cho máy đời cũ: SetThreadExecutionState.
        const bool legacy = SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) != 0;
        active = power || legacy;
        sendLine(std::string("info string keepawake ") + (active ? "on" : "failed") + " powerRequest=" + (power ? "1" : "0") + " legacy=" + (legacy ? "1" : "0"));
#endif
    }
    ~KeepAwakeGuard() {
#ifdef _WIN32
        if (request && request != INVALID_HANDLE_VALUE) {
            PowerClearRequest(request, PowerRequestExecutionRequired);
            PowerClearRequest(request, PowerRequestSystemRequired);
            CloseHandle(request);
        }
        if (active) SetThreadExecutionState(ES_CONTINUOUS);
#endif
    }
};

void runAnalyze(int maxBudget, long long movetimeMs, int fromBudget) {
    KeepAwakeGuard keepAwake;
    if (maxBudget < 1 || maxBudget > UNLIMITED_MAX_BUDGET_PER_SIDE || fromBudget > maxBudget)
        throw std::invalid_argument("budget must be 1..60 and from <= budget");
    if (movetimeMs < 0 || movetimeMs > 86400000) throw std::invalid_argument("invalid movetime");
    auto session = std::make_unique<SearchSession>();
    captureSession(*session);
    session->state.restrictedSide = session->restrictedSide;
    bool loaded = false;
    const std::string loadMsg = ck::load(*session, loaded);
    if (!loadMsg.empty()) sendLine(loadMsg);

    auto finish = [&](const char* outcome, const std::string& best) {
        sendLine(std::string("info string outcome ") + outcome);
        sendLine("bestmove " + best);
        g_searching = false;
    };

    if (session->mateFound) {   // đã có kết quả từ lần chạy trước
        std::ostringstream line;
        line << "info depth " << session->mateBudget << " score mate " << session->mateK << " nodes "
             << totalNodes(session->state, session->workers) << " time " << session->accumulatedMs << formatPv(session->matePv);
        sendLine(line.str());
        sendLine("info string analyze resumed result=cached");
        finish("mate", session->matePv.empty() ? std::string("(none)") : moveToUci(session->matePv[0]));
        return;
    }
    if (session->completedBudget >= maxBudget) {   // đã quét trọn tới maxBudget mà không có mate
        sendLine("info string analyze resumed result=cached");
        finish("draw", "(none)");
        return;
    }

    session->requestedBudget = maxBudget;
    const auto t0 = SearchClock::now();
    const auto elapsedMs = [&] {
        return static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(SearchClock::now() - t0).count());
    };
    GoResult r;
    for (;;) {
        long long sliceMs = 0;                       // 0 = không giới hạn
        if (g_autosaveSec > 0) {
            sliceMs = static_cast<long long>(g_autosaveSec) * 1000;
            // Một lần lưu tốn bao nhiêu thì cho lát dài gấp 10 lần: tệp lớn (hàng trăm MB) không làm phân tích chậm quá ~10%.
            sliceMs = std::max(sliceMs, 10 * g_lastSaveMs.load());
        }
        if (movetimeMs > 0) {
            const long long remaining = movetimeMs - elapsedMs();
            if (remaining <= 0) break;
            sliceMs = sliceMs > 0 ? std::min(sliceMs, remaining) : remaining;
        }
        r = GoResult{};
        runGoBudgetImpl(maxBudget, sliceMs, fromBudget, session.get(), &r);
        const std::string saveMsg = ck::save(*session);
        if (!saveMsg.empty()) sendLine(saveMsg);
        if (r.foundMate || r.cancelled || r.done >= maxBudget) break;
        if (movetimeMs > 0 && elapsedMs() >= movetimeMs) break;
    }

    if (r.foundMate) {
        finish("mate", r.mate.line.empty() ? std::string("(none)") : moveToUci(r.mate.line[0]));
    } else if (r.cancelled) {
        sendLine("info string cancelled");
        finish("partial", "(none)");
    } else if (r.done >= maxBudget) {
        finish("draw", "(none)");
    } else {
        finish("partial", "(none)");
    }
}

// Probe một cặp ngân sách R/B đã còn lại sau một nước của line. Khác với
// go budget N (N/N), kết quả draw ở đây đúng với số nước còn lại từng bên.
void runGoBudgetPair(int redBudget, int blackBudget, long long movetimeMs, SearchSession* session = nullptr) {
    if (redBudget < 0 || blackBudget < 0 || redBudget > UNLIMITED_MAX_BUDGET_PER_SIDE || blackBudget > UNLIMITED_MAX_BUDGET_PER_SIDE)
        throw std::invalid_argument("budgets must be 0..60");
    if (movetimeMs < 0 || movetimeMs > 86400000) throw std::invalid_argument("invalid movetime");
    auto t0 = SearchClock::now();
    auto deadline = (movetimeMs > 0)
        ? t0 + std::chrono::milliseconds(movetimeMs)
        : SearchClock::time_point::max();

    auto freshState = session ? nullptr : std::make_unique<MateSearchState>();
    MateSearchState& st = session ? session->state : *freshState;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.checkStreakBonusRuleOn = g_checkStreakBonusRuleOn;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    st.deadline = deadline;
    auto freshWorkers = session ? nullptr : std::make_unique<std::vector<MateSearchState>>();
    std::vector<MateSearchState>& workers = session ? session->workers : *freshWorkers;
    ensureWorkerPool(workers, st);

    g_splitStats.reset();
    Board board = g_board;
    Color color = g_sideToMove;
    Board scratch = board;
    ProbeResult res = probeForcedMate(scratch, color, std::max(0, redBudget), std::max(0, blackBudget),
                                      g_csRootRed, g_csRootBlack, st, workers, g_threads);
    emitSplitStats();
    if (session) {
        session->accumulatedMs += std::chrono::duration_cast<std::chrono::milliseconds>(
            SearchClock::now() - t0).count();
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
        SearchClock::now() - t0).count();
    if (res.mate) {
        int k = g_ktcBudgetOn ? depth
            : ((res.score > 0) ? (MATE_SCORE - res.score + 1) / 2 : (MATE_SCORE + res.score) / 2);
        std::ostringstream line;
        line << "info depth " << depth << " score mate " << (res.score > 0 ? k : -k)
             << " nodes " << totalNodes(st, workers) << " time " << elapsedMs;
        sendLine(line.str() + formatPv(res.line));
        sendLine("bestmove " + (res.line.empty() ? "(none)" : moveToUci(res.line[0])));
    } else {
        std::ostringstream line;
        line << "info depth " << depth << " score cp 0 nodes " << totalNodes(st, workers) << " time " << elapsedMs;
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
    auto t0 = SearchClock::now();

    MateSearchState st;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.checkStreakBonusRuleOn = g_checkStreakBonusRuleOn;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    st.deadline = SearchClock::time_point::max();
    std::vector<MateSearchState> workers;
    ensureWorkerPool(workers, st);

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
            clearWorkerPool(workers);
            ProbeResult probe = probeForcedMate(board, otherColor(side), afterRed, afterBlack,
                                                 g_csRootRed, g_csRootBlack, st, workers, g_threads);
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
        SearchClock::now() - t0).count();
    std::ostringstream info;
    info << "info depth " << depth << " score cp 0 nodes " << totalNodes(st, workers) << " time " << elapsedMs;
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
    auto t0 = SearchClock::now();
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
                SearchClock::now() - t0).count();
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
        // Tôn trọng giá trị xin: 0/"auto" = số nhân CPU, còn lại kẹp [1, 64].
        if (value == "0" || value == "auto") g_threads = g_hwThreads;
        else {
            try { g_threads = std::min(64, std::max(1, std::stoi(value))); } catch (...) {}
        }
    }
    else if (name == "SplitMode") {
        g_splitMode = (value == "moves") ? SplitMode::Moves : (value == "pieces") ? SplitMode::Pieces : SplitMode::Dynamic;
    }
    else if (name == "ProgressMs") {
        try { g_progressMs = std::max(0, std::min(60000, std::stoi(value))); } catch (...) {}
    }
    else if (name == "KeepAwake") {
        g_keepAwake = (value == "true" || value == "1" || value == "on");
    }
    else if (name == "DataDir") {
        g_dataDir = value;   // rỗng = tắt lưu tiến độ
    }
    else if (name == "AutosaveSec") {
        try { g_autosaveSec = std::max(0, std::min(86400, std::stoi(value))); } catch (...) {}
    }
    else if (name == "WitnessLimit") {
        try { g_mateWitnessLimit = static_cast<size_t>(std::max(1000, std::min(50'000'000, std::stoi(value)))); } catch (...) {}
    }
    else if (name == "HashBits") {
        try { g_hashBits = std::max(TranspositionTable::MIN_BITS, std::min(TranspositionTable::MAX_BITS, std::stoi(value))); } catch (...) {}
    }
    else if (name == "WorkSteal") {
        g_workSteal = (value == "true" || value == "1" || value == "on");
    }
    else if (name == "ShareAlpha") {
        g_shareAlpha = (value == "true" || value == "1" || value == "on");
    }
    else if (name == "CheckStreak_RestrictedColor") {
        // "both" = cả hai bên bị giới hạn (chế độ Duyệt & Điều Khiển của app); "white"/"black" =
        // chỉ bên đó (chế độ Phân Tích, bất đối xứng); còn lại = tắt luật.
        g_restrictedSide = (value == "white") ? CsSide::Red
            : (value == "black") ? CsSide::Black
            : (value == "both") ? CsSide::Both : CsSide::None;
    } else if (name == "CheckStreak_Limit") {
        try { g_checkStreakLimit = std::max(1, std::stoi(value)); } catch (...) {}
    } else if (name == "CheckStreak_BonusRule") {
        // Luật mở rộng tuỳ chọn "cản rồi bị ăn mà vẫn chiếu" — khớp checkStreakBonusRuleOn bên app.
        g_checkStreakBonusRuleOn = (value == "true" || value == "1" || value == "on");
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


// ===================== "book build": sách đáp án (cây chứng minh) =====================
// Sau khi đã có mate, đi lại cây chứng minh: ở thế bên tấn công đến lượt, tìm nước thắng (dò bù nhanh nhờ bảng băm đã
// nạp từ tiến độ); rồi với MỌI nước đáp hợp lệ của bên thủ, lặp lại. Mỗi thế của bên tấn công in một dòng:
//   book <FEN với _ thay dấu cách> <chuỗiChiếuĐỏ> <chuỗiChiếuĐen> <nướcThắng> <sốNướcTớiChiếuBí> <ngânSáchĐỏ> <ngânSáchĐen>
// Bên Node ghi vào SQLite. Khóa tra cứu = FEN + trạng thái chiếu liên tục; nhờ vậy khi chơi thật chỉ cần dựng FEN sau
// nước đối phương rồi tra nước thắng tiếp theo.
struct BookKey {
    i32 h1, h2;
    CsCode csRed, csBlack;
    bool isRed;
    bool operator==(const BookKey& o) const { return h1 == o.h1 && h2 == o.h2 && csRed == o.csRed && csBlack == o.csBlack && isRed == o.isRed; }
};
struct BookKeyHash {
    size_t operator()(const BookKey& k) const {
        uint64_t h = (static_cast<uint64_t>(static_cast<uint32_t>(k.h1)) << 32) ^ static_cast<uint32_t>(k.h2);
        h ^= static_cast<uint64_t>(k.csRed) * 0x9E3779B97F4A7C15ULL;
        h ^= static_cast<uint64_t>(k.csBlack) * 0xBF58476D1CE4E5B9ULL;
        return static_cast<size_t>(h ^ (k.isRed ? 0x94D049BB133111EBULL : 0));
    }
};

struct BookStep { int rb, bb; CsCode csR, csB; i32 h1, h2; };

struct BookBuilder {
    Board b;
    MateSearchState& st;
    size_t limit;
    size_t count = 0, unresolved = 0;
    bool truncated = false;
    // Tiến độ lưu ra file <FEN>.bookrows (cạnh .bfck) để lần sau làm tiếp: dòng "row ...", "done ..." (nút đã xong), "end".
    std::ofstream progress;
    std::filesystem::path progressPath;
    std::chrono::steady_clock::time_point lastFlush = std::chrono::steady_clock::now();
    void flushProgress(bool force) {
        if (!progress.is_open()) return;
        const auto now = std::chrono::steady_clock::now();
        if (!force && now - lastFlush < std::chrono::seconds(2)) return;
        progress.flush();
        ck::flushFileToDisk(progressPath);
        lastFlush = now;
    }
    void markDone(const BookKey& key, int value) {
        if (!progress.is_open() || value <= 0 || g_cancelled.load() || st.timeUp() || truncated) return;
        progress << "done " << key.h1 << ' ' << key.h2 << ' ' << key.csRed << ' ' << key.csBlack << ' ' << (key.isRed ? 1 : 0) << ' ' << value << '\n';
        flushProgress(false);
    }
    std::unordered_set<BookKey, BookKeyHash> devDone;   // vòng lưu tiếp sau nước sai đã xong (dùng khi làm tiếp)
    int devRounds = 1;   // sau một nước sai: số vòng (nước công bất kỳ + nước đáp) được lưu tiếp
    int maxDepth = 1 << 30;   // chỉ lưu các thế bên tấn công ở tầng < maxDepth (số nước công đã đi); sâu hơn để engine giải khi chơi

    BookBuilder(const Board& board, MateSearchState& state, size_t maxPositions) : b(board), st(state), limit(maxPositions) {}

    // Đi một nước và cập nhật ngân sách / chuỗi chiếu / băm giống hệt vòng lặp của negamaxForcedMateGen.
    // Trả false nếu nước này phạm luật chiếu liên tục (bên đi thua ngay) — không thuộc cây chứng minh.
    bool step(Color color, const Move& mv, BookStep& s, Piece& captured) {
        const Piece moved = b[mv.from.row][mv.from.col];
        const Color opp = otherColor(color);
        Square kingSq;
        const bool haveKing = findKing(b, color, kingSq);
        const bool inCheckNow = haveKing && isKingAttacked(b, color, kingSq);
        const bool ktcSkip = st.ktcBudgetOn && st.ktcExemptColor != Color::None && color == st.ktcExemptColor
            && moved.type == PieceType::King && b[mv.to.row][mv.to.col].empty() && inCheckNow;
        captured = makeMoveInPlace(b, mv);
        const bool isRed = color == Color::Red;
        Square oppKing;
        if (csRestricted(st.restrictedSide, color) && findKing(b, opp, oppKing)) {
            const CsCode ncs = csAdvanceAfterMove(b, isRed ? s.csR : s.csB, mv, color, oppKing, st.restrictedSide,
                                                  st.checkStreakLimit, st.checkStreakBonusRuleOn, !captured.empty());
            if (ncs < 0) { undoMoveInPlace(b, mv, captured); return false; }
            if (isRed) s.csR = ncs; else s.csB = ncs;
        }
        const int consume = ktcSkip ? 0 : 1;
        if (isRed) s.rb -= consume; else s.bb -= consume;
        const int fromSq = squareIndex(mv.from), toSq = squareIndex(mv.to);
        const HashPair fromZ = pieceZobrist(moved.type, moved.color, fromSq);
        const HashPair toZ = pieceZobrist(moved.type, moved.color, toSq);
        s.h1 ^= fromZ.h1 ^ toZ.h1 ^ g_zobristTurn1;
        s.h2 ^= fromZ.h2 ^ toZ.h2 ^ g_zobristTurn2;
        if (!captured.empty()) {
            const HashPair capZ = pieceZobrist(captured.type, captured.color, toSq);
            s.h1 ^= capZ.h1; s.h2 ^= capZ.h2;
        }
        return true;
    }

    // Bộ nhớ đệm theo thế (trùng thế do hoán vị nước đi): kết quả mateK của nút đó (0 = không giải được).
    std::unordered_map<BookKey, int, BookKeyHash> memo;

    // Thế bên TẤN CÔNG đến lượt: tìm nước thắng ngắn nhất, ghi dòng "A", rồi xét mọi nước đáp của bên thủ.
    // Trả số nước còn lại của bên tấn công tới chiếu bí (0 nếu không giải được / bị dừng).
    int attackerNode(Color color, const BookStep& s, int depth = 0) {
        if (g_cancelled.load() || st.timeUp()) return 0;
        const BookKey key{s.h1, s.h2, s.csR, s.csB, color == Color::Red};
        const auto known = memo.find(key);
        if (known != memo.end()) return known->second;
        if (count >= limit) { truncated = true; return 0; }
        memo[key] = 0;   // chặn đệ quy lặp

        const std::vector<Move> moves = forcedMateRootMoves(b, color, st);
        if (moves.empty() || s.rb < 1) { ++unresolved; return 0; }
        const SearchResult r = negamaxForcedMateRootSubsetGen(b, color, s.rb, s.bb, moves, MATE_THRESHOLD, MATE_SCORE,
                                                              s.h1, s.h2, s.csR, s.csB, st);
        if (g_cancelled.load() || st.timeUp()) return 0;
        if (r.score <= MATE_THRESHOLD || r.line.empty()) { ++unresolved; return 0; }
        const Move best = r.line[0];
        const int mateK = st.ktcBudgetOn ? s.rb : (MATE_SCORE - r.score + 1) / 2;
        if (depth >= maxDepth) { memo[key] = mateK; markDone(key, mateK); return mateK; }   // tầng biên: chỉ cần số nước, không lưu
        emitRow('A', color, s, best, mateK);

        BookStep afterBest = s;
        Piece capBest;
        if (!step(color, best, afterBest, capBest)) { ++unresolved; return 0; }
        expandDefender(otherColor(color), color, afterBest, depth + 1);
        undoMoveInPlace(b, best, capBest);
        memo[key] = mateK;

        // Người chơi (bên tấn công) có thể đi MỌI nước hợp lệ, không chỉ nước thắng. Nước vẫn giữ được mate trong ngân sách
        // còn lại: dựng đủ nhánh bên thủ. Nước làm MẤT mate (đi sai): lưu một dòng "D" với nước đáp giúp bên thủ thoát mate
        // (mateIn = 0) để người chơi không bị bơ vơ; sau nước đáp đó để engine lo.
        std::vector<Move> legal;
        generateLegalMoves(b, color, legal);
        auto sameMove = [](const Move& x, const Move& y) {
            return x.from.row == y.from.row && x.from.col == y.from.col && x.to.row == y.to.row && x.to.col == y.to.col;
        };
        struct Losing { Move alt; Move reply; };
        std::vector<Move> winners;
        std::vector<Losing> losers;
        // Pha 1: phân loại mọi nước; nước sai thì ghi NGAY dòng nước đáp thoát (rẻ) để tra được sớm.
        for (const Move& alt : legal) {
            if (g_cancelled.load() || st.timeUp() || truncated) break;
            if (sameMove(alt, best)) continue;
            bool winning = false;
            if (std::any_of(moves.begin(), moves.end(), [&](const Move& m) { return sameMove(m, alt); })) {
                const std::vector<Move> only{alt};
                const SearchResult ra = negamaxForcedMateRootSubsetGen(b, color, s.rb, s.bb, only, MATE_THRESHOLD, MATE_SCORE,
                                                                       s.h1, s.h2, s.csR, s.csB, st);
                if (g_cancelled.load() || st.timeUp()) break;
                winning = ra.score > MATE_THRESHOLD;
            }
            if (winning) { winners.push_back(alt); continue; }
            BookStep afterAlt = s;
            Piece capAlt;
            if (!step(color, alt, afterAlt, capAlt)) continue;
            Move reply{};
            if (escapeRow(otherColor(color), color, afterAlt, 0, &reply)) losers.push_back({alt, reply});
            undoMoveInPlace(b, alt, capAlt);
        }
        // Pha 2: các nước vẫn giữ mate — dựng đủ nhánh bên thủ.
        for (const Move& alt : winners) {
            if (g_cancelled.load() || st.timeUp() || truncated) break;
            BookStep afterAlt = s;
            Piece capAlt;
            if (!step(color, alt, afterAlt, capAlt)) continue;
            expandDefender(otherColor(color), color, afterAlt, depth + 1);
            undoMoveInPlace(b, alt, capAlt);
        }
        // Pha 3: sau nước sai + nước đáp, lưu tiếp devRounds vòng (nặng nhất, làm sau cùng; có đánh dấu để làm tiếp).
        if (devRounds > 0) {
            for (const Losing& l : losers) {
                if (g_cancelled.load() || st.timeUp() || truncated) break;
                BookStep afterAlt = s;
                Piece capAlt;
                if (!step(color, l.alt, afterAlt, capAlt)) continue;
                const BookKey dk{afterAlt.h1, afterAlt.h2, afterAlt.csR, afterAlt.csB, otherColor(color) == Color::Red};
                if (devDone.count(dk) == 0) {
                    BookStep afterReply = afterAlt;
                    Piece capReply;
                    if (afterAlt.rb >= 1 && step(otherColor(color), l.reply, afterReply, capReply)) {
                        devNode(color, otherColor(color), afterReply, devRounds);
                        undoMoveInPlace(b, l.reply, capReply);
                    }
                    if (!g_cancelled.load() && !st.timeUp() && !truncated && progress.is_open()) {
                        progress << "dd " << dk.h1 << ' ' << dk.h2 << ' ' << dk.csRed << ' ' << dk.csBlack << ' ' << (dk.isRed ? 1 : 0) << '\n';
                        flushProgress(false);
                    }
                }
                undoMoveInPlace(b, l.alt, capAlt);
            }
        }
        markDone(key, mateK);
        return mateK;
    }

    // Thế bên thủ đến lượt sau một nước sai của bên tấn công: tìm nước đáp khiến bên tấn công KHÔNG còn mate trong ngân sách
    // còn lại và ghi một dòng "D" (mateIn = 0). Không tìm thấy (thực ra vẫn thắng) thì bỏ qua.
    bool escapeRow(Color def, Color att, const BookStep& s, int devLeft, Move* foundReply = nullptr) {
        std::vector<Move> replies;
        generateLegalMoves(b, def, replies);
        for (const Move& reply : replies) {
            if (g_cancelled.load() || st.timeUp() || truncated) return false;
            BookStep after = s;
            Piece cap;
            if (!step(def, reply, after, cap)) continue;
            bool mated = false;
            if (after.rb >= 1) {
                const std::vector<Move> attMoves = forcedMateRootMoves(b, att, st);
                if (!attMoves.empty()) {
                    const SearchResult r = negamaxForcedMateRootSubsetGen(b, att, after.rb, after.bb, attMoves, MATE_THRESHOLD, MATE_SCORE,
                                                                          after.h1, after.h2, after.csR, after.csB, st);
                    if (g_cancelled.load() || st.timeUp()) { undoMoveInPlace(b, reply, cap); return false; }
                    mated = r.score > MATE_THRESHOLD;
                }
            }
            undoMoveInPlace(b, reply, cap);
            if (!mated) {
                emitRow('D', def, s, reply, 0);
                if (foundReply) *foundReply = reply;
                if (devLeft > 0 && after.rb >= 1) {
                    Piece cap2;
                    BookStep next = s;
                    if (step(def, reply, next, cap2)) { devNode(att, def, next, devLeft); undoMoveInPlace(b, reply, cap2); }
                }
                return true;
            }
        }
        return false;
    }

    // Sau nước đáp thoát mate: bên công đi MỌI nước hợp lệ, với mỗi nước lưu nước đáp của bên thủ (và tiếp tục devLeft-1 vòng).
    void devNode(Color att, Color def, const BookStep& s, int devLeft) {
        std::vector<Move> legal;
        generateLegalMoves(b, att, legal);
        for (const Move& a : legal) {
            if (g_cancelled.load() || st.timeUp() || truncated) return;
            BookStep afterA = s;
            Piece capA;
            if (!step(att, a, afterA, capA)) continue;
            escapeRow(def, att, afterA, devLeft - 1);
            undoMoveInPlace(b, a, capA);
        }
    }

    // Thế bên THỦ đến lượt (bên tấn công là `att`): xét mọi nước đáp hợp lệ, đệ quy xuống thế của bên tấn công, rồi ghi
    // dòng "D" với nước đáp làm bên tấn công cần NHIỀU nước nhất (cầm cự lâu nhất). Trả số nước đó (0 nếu bên thủ hết nước đi).
    int expandDefender(Color def, Color att, const BookStep& s, int depth = 0) {
        if (g_cancelled.load() || st.timeUp()) return 0;
        const BookKey key{s.h1, s.h2, s.csR, s.csB, def == Color::Red};
        const auto known = memo.find(key);
        if (known != memo.end()) return known->second;
        memo[key] = 0;

        std::vector<Move> replies;
        generateLegalMoves(b, def, replies);
        int worst = 0;
        Move worstMove{};
        for (const Move& reply : replies) {
            BookStep afterReply = s;
            Piece capReply;
            if (step(def, reply, afterReply, capReply)) {
                const int childMate = attackerNode(att, afterReply, depth);
                undoMoveInPlace(b, reply, capReply);
                if (childMate > worst) { worst = childMate; worstMove = reply; }
            }
            if (g_cancelled.load() || st.timeUp() || truncated) break;
        }
        if (worst > 0) emitRow('D', def, s, worstMove, worst);
        memo[key] = worst;
        markDone(key, worst);
        return worst;
    }

    void emitRow(char kind, Color toMove, const BookStep& s, const Move& mv, int mateK) {
        std::string fen = boardToXiangqiFen(b, toMove);
        for (char& ch : fen) if (ch == ' ') ch = '_';
        const std::string body = std::string(1, kind) + " " + fen + " " + std::to_string(s.csR) + " " + std::to_string(s.csB) + " "
                 + moveToUci(mv) + " " + std::to_string(mateK) + " " + std::to_string(s.rb) + " " + std::to_string(s.bb);
        sendLine("book " + body);
        if (progress.is_open()) { progress << "row " << body << '\n'; flushProgress(false); }
        ++count;
        if (count % 5000 == 0) sendLine("info string book progress count=" + std::to_string(count));
    }
};

void runBookBuild(size_t maxPositions, int depthArg, bool fresh, int devArg) {
    if (g_dataDir.empty()) throw std::invalid_argument("DataDir is required");
    auto session = std::make_unique<SearchSession>();
    captureSession(*session);
    bool loaded = false;
    const std::string loadMsg = ck::load(*session, loaded);
    if (!loadMsg.empty()) sendLine(loadMsg);
    if (!loaded || !session->mateFound) {
        sendLine("info string book ERROR no mate stored for this position (run analyze first)");
        g_searching = false;
        return;
    }
    MateSearchState& st = session->state;
    st.restrictedSide = g_restrictedSide;
    st.checkStreakLimit = g_checkStreakLimit;
    st.checkStreakBonusRuleOn = g_checkStreakBonusRuleOn;
    st.ktcBudgetOn = g_ktcBudgetOn;
    st.cancelled = &g_cancelled;
    st.deadline.reset();
    const Color color = g_sideToMove;
    const bool rootIsAttacker = session->mateK > 0;       // mate âm: bên đi trước bị ép thua, gốc là thế của bên THỦ
    const Color attacker = rootIsAttacker ? color : otherColor(color);
    st.ktcExemptColor = attacker;
    int winRed = session->mateBudget, winBlack = session->mateBudget;
    ktcSearchBudgets(attacker, session->mateBudget, session->mateBudget, st.ktcBudgetOn, winRed, winBlack);
    Board board = g_board;
    const HashPair hp = hashBoardPair(board);
    BookBuilder builder(board, st, maxPositions);
    // Mặc định lưu một nửa số nước mate (làm tròn lên); nửa sau để engine giải lúc chơi. depth < 0: lưu đầy đủ.
    const int absMate = std::abs(session->mateK);
    builder.devRounds = devArg < 0 ? 0 : devArg;
    builder.maxDepth = depthArg < 0 ? (1 << 30) : (depthArg > 0 ? depthArg : (absMate + 1) / 2);

    // Làm tiếp: đọc file tiến độ (nếu cùng thế/luật/độ sâu), phát lại các dòng đã có và nhớ các nút đã xong.
    {
        std::ostringstream meta;
        meta << "meta mate=" << session->mateK << " budget=" << session->mateBudget << " depth=" << builder.maxDepth
             << " rs=" << static_cast<int>(g_restrictedSide) << " lim=" << g_checkStreakLimit << " bonus=" << (g_checkStreakBonusRuleOn ? 1 : 0)
             << " ktc=" << (g_ktcBudgetOn ? 1 : 0) << " dev=" << builder.devRounds;
        namespace fs = std::filesystem;
        builder.progressPath = ck::pathFor(*session);
        builder.progressPath.replace_extension(".bookrows");
        std::error_code ec;
        if (fresh) fs::remove(builder.progressPath, ec);
        bool reuse = false, wasComplete = false;
        size_t replayed = 0, doneNodes = 0;
        {
            std::ifstream in(builder.progressPath, std::ios::binary);
            std::string content((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
            std::vector<std::string> lines;
            size_t pos = 0;
            while (true) {   // chỉ nhận các dòng đã kết thúc bằng '\n' (dòng cuối ghi dở thì bỏ)
                const size_t nlPos = content.find('\n', pos);
                if (nlPos == std::string::npos) break;
                std::string ln = content.substr(pos, nlPos - pos);
                if (!ln.empty() && ln.back() == '\r') ln.pop_back();
                lines.push_back(std::move(ln));
                pos = nlPos + 1;
            }
            if (!lines.empty() && lines[0] == meta.str()) {
                reuse = true;
                for (size_t i = 1; i < lines.size(); ++i) {
                    const std::string& ln = lines[i];
                    if (ln.compare(0, 4, "row ") == 0) { sendLine("book " + ln.substr(4)); ++builder.count; ++replayed; }
                    else if (ln.compare(0, 5, "done ") == 0) {
                        std::istringstream ds(ln.substr(5));
                        long long h1 = 0, h2 = 0; int cr = 0, cb = 0, red = 0, val = 0;
                        if (ds >> h1 >> h2 >> cr >> cb >> red >> val)
                            { builder.memo[BookKey{static_cast<i32>(h1), static_cast<i32>(h2), static_cast<CsCode>(cr), static_cast<CsCode>(cb), red != 0}] = val; ++doneNodes; }
                    } else if (ln.compare(0, 3, "dd ") == 0) {
                        std::istringstream ds(ln.substr(3));
                        long long h1 = 0, h2 = 0; int cr = 0, cb = 0, red = 0;
                        if (ds >> h1 >> h2 >> cr >> cb >> red)
                            builder.devDone.insert(BookKey{static_cast<i32>(h1), static_cast<i32>(h2), static_cast<CsCode>(cr), static_cast<CsCode>(cb), red != 0});
                    } else if (ln == "end") wasComplete = true;
                }
            }
        }
        if (reuse && replayed > 0) sendLine("info string book resume rows=" + std::to_string(replayed) + " nodes=" + std::to_string(doneNodes) + (wasComplete ? " complete=1" : " complete=0"));
        builder.progress.open(builder.progressPath, reuse ? (std::ios::binary | std::ios::app) : (std::ios::binary | std::ios::trunc));
        if (!reuse) builder.progress << meta.str() << '\n';
        builder.progress.flush();
    }
    sendLine("info string book begin mate=" + std::to_string(session->mateK) + " budget=" + std::to_string(session->mateBudget) + " depth=" + std::to_string(builder.maxDepth));
    const BookStep rootStep{winRed, winBlack, g_csRootRed, g_csRootBlack, hp.h1, hp.h2};
    if (rootIsAttacker) builder.attackerNode(color, rootStep);
    else builder.expandDefender(color, attacker, rootStep);
    if (!g_cancelled.load() && !builder.truncated && builder.progress.is_open()) builder.progress << "end\n";
    builder.flushProgress(true);
    builder.progress.close();
    std::ostringstream done;
    done << "info string book done count=" << builder.count << " unresolved=" << builder.unresolved
         << " truncated=" << (builder.truncated ? 1 : 0) << " cancelled=" << (g_cancelled.load() ? 1 : 0);
    sendLine(done.str());
    g_searching = false;
}

// ===================== [testphantich] tắt an toàn =====================
// Cửa sổ bị đóng / đăng xuất / tắt máy / SIGTERM / SIGHUP: dừng tìm kiếm và ĐỢI lưu xong tiến độ rồi mới thoát.
// Ctrl+C và Ctrl+Break bị bỏ qua ở tiến trình engine (tiến trình cha gửi lệnh "stop" và chờ), vì nếu không thì
// Ctrl+C trong cùng cửa sổ sẽ giết engine ngay trước khi nó kịp lưu.
void gracefulShutdown() {
    g_cancelled = true;
    for (int i = 0; i < 300 && g_searching.load(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
}

#ifdef _WIN32
BOOL WINAPI consoleHandler(DWORD type) {
    switch (type) {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
            return TRUE;
        case CTRL_CLOSE_EVENT:
        case CTRL_LOGOFF_EVENT:
        case CTRL_SHUTDOWN_EVENT:
            gracefulShutdown();
            return TRUE;
        default:
            return FALSE;
    }
}
void installShutdownHandlers() { SetConsoleCtrlHandler(consoleHandler, TRUE); }
#else
std::atomic<bool> g_terminateRequested{false};
void onTerminateSignal(int) { g_terminateRequested = true; }
void installShutdownHandlers() {
    std::signal(SIGINT, SIG_IGN);
    std::signal(SIGTERM, onTerminateSignal);
    std::signal(SIGHUP, onTerminateSignal);
    std::thread([] {
        while (!g_terminateRequested.load()) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        gracefulShutdown();
        _exit(0);
    }).detach();
}
#endif

bool executeCommandLine(const std::string& line) {
        std::istringstream iss(line);
        std::string cmd;
        iss >> cmd;

        if (cmd == "bruteforce") {
            sendLine("id name Brute-force");
            sendLine("id author cong dong du an Xiangqi Analyzer");
            sendLine("option name Threads type spin default 1 min 0 max 64");
            sendLine("option name SplitMode type combo default dynamic var dynamic var pieces var moves");
            sendLine("option name ShareAlpha type check default true");
            sendLine("option name WorkSteal type check default true");
            sendLine("option name DataDir type string default");
            sendLine("option name KeepAwake type check default true");
            sendLine("option name ProgressMs type spin default 1000 min 0 max 60000");
            sendLine("option name AutosaveSec type spin default 60 min 0 max 86400");
            sendLine("option name HashBits type spin default 22 min 16 max 26");
            sendLine("option name WitnessLimit type spin default 500000 min 1000 max 50000000");
            sendLine("info string hardware threads " + std::to_string(g_hwThreads));
            sendLine("option name CheckStreak_RestrictedColor type string default none");
            sendLine("option name CheckStreak_Limit type spin default 2 min 1 max 20");
            sendLine("option name CheckStreak_BonusRule type check default false");
            sendLine("option name CheckStreak_RootRed type string default none");
            sendLine("option name CheckStreak_RootBlack type string default none");
            sendLine("option name KtcBudget type check default false");
            sendLine("info string features checkpoint book");
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
        } else if (cmd == "simulate") {   // kiểm thử tắt an toàn: giả lập sự kiện của hệ điều hành
            std::string what;
            iss >> what;
            if (what == "ctrl_c") {
                sendLine("info string simulate ctrl_c ignored");
            } else if (what == "close") {
                sendLine("info string simulate close begin");
                gracefulShutdown();
                sendLine("info string simulate close done");
                std::cout.flush();
                std::_Exit(0);
            }
        } else if (cmd == "book") {
            std::string action;
            iss >> action;
            if (action == "build") {
                size_t maxPositions = static_cast<size_t>(-1);   // không giới hạn (độ sâu đã chặn kích thước)
                int depthArg = 0;
                bool fresh = false;
                int devArg = 1;
                std::string word;
                while (iss >> word) {
                    if (word == "max") { long long v = 0; iss >> v; if (v > 0) maxPositions = static_cast<size_t>(v); }
                    else if (word == "depth") iss >> depthArg;
                    else if (word == "fresh") fresh = true;
                    else if (word == "dev") iss >> devArg;
                }
                stopSearch();
                startSearch(runBookBuild, maxPositions, depthArg, fresh, devArg);
            } else sendLine("info string book ERROR unknown action (build)");
        } else if (cmd == "analyze") {
            std::string word;
            int budget = 0, fromBudget = 1;
            long long movetimeMs = 0;
            while (iss >> word) {
                if (word == "budget") iss >> budget;
                else if (word == "movetime") iss >> movetimeMs;
                else if (word == "from") iss >> fromBudget;
            }
            if (budget <= 0) budget = UNLIMITED_MAX_BUDGET_PER_SIDE;
            if (fromBudget < 1) fromBudget = 1;
            stopSearch();
            startSearch(runAnalyze, budget, movetimeMs, fromBudget);
        } else if (cmd == "checkpoint") {
            std::string action;
            iss >> action;
            stopSearch();
            if (action == "list") ck::list();
            else if (action == "clear") {   // xoá tiến độ của bài toán hiện tại (thế cờ + luật đang đặt)
                if (!g_positionValid) throw std::invalid_argument("position is not valid");
                SearchSession probe;
                captureSession(probe);
                std::error_code ec;
                ck::migrateLegacy();
                const bool removed = !g_dataDir.empty() && std::filesystem::remove(ck::pathFor(probe), ec);
                sendLine(std::string("info string checkpoint clear removed=") + (removed ? "1" : "0"));
            } else sendLine("info string checkpoint ERROR unknown action (list|clear)");
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
    installShutdownHandlers();
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
