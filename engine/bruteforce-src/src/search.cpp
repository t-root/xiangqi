// Cổng chính xác từ negamaxForcedMateGen / negamaxForcedMateRootSubsetGen / mateOrderScore /
// orderMovesForMate / probeForcedMateAlphaBetaGen (xiangqi-analyzer.html:1625-1640, 3301-3461,
// 3689-3704). Bỏ cơ chế "generator + yield mỗi N nút" của JS vì đó chỉ là cách nhường CPU trong
// một luồng JS đơn — native thread không cần, không ảnh hưởng thuật toán/kết quả.

#include "search.h"
#include "eval.h"
#include <algorithm>
#include <limits>

namespace BruteForce {

namespace {

i64 mateOrderScore(const ScoredMove& m, i32 code, i32 ttCode, i32 killA, i32 killB, const MateSearchState& st) {
    if (code == ttCode) return 3'000'000'000LL;
    if (!m.captured.empty()) {
        return 10'000'000LL + static_cast<i64>(pieceValue(m.captured.type)) * 100 - pieceValue(m.piece.type);
    }
    if (code == killA) return 9'000'000LL;
    if (code == killB) return 8'000'000LL;
    return st.mateHistoryScores[historyIndex(m)];
}

// Khớp orderMovesForMate (:1636-1640).
void orderMovesForMate(std::vector<ScoredMove>& moves, i32 ttCode, int ply, const MateSearchState& st) {
    i32 killA = st.mateKillerA[ply], killB = st.mateKillerB[ply];
    for (auto& m : moves) m.ord = mateOrderScore(m, moveCode(m.from, m.to) + 1, ttCode, killA, killB, st);
    std::sort(moves.begin(), moves.end(), [](const ScoredMove& a, const ScoredMove& b) { return a.ord > b.ord; });
}

std::vector<ScoredMove> pseudoScoredMoves(const Board& b, Color color) {
    std::vector<Move> raw;
    raw.reserve(128);
    generatePseudoMoveList(b, color, raw);
    std::vector<ScoredMove> out;
    out.reserve(raw.size());
    for (const Move& m : raw) {
        ScoredMove sm;
        sm.from = m.from; sm.to = m.to;
        sm.piece = b[m.from.row][m.from.col];
        sm.captured = b[m.to.row][m.to.col];
        out.push_back(sm);
    }
    return out;
}

}  // namespace

namespace {

constexpr size_t MATE_WITNESS_LIMIT = 120000;

MateWitnessKey witnessKey(i32 h1, i32 h2, int redBudget, int blackBudget,
                          Color color, CsCode csRed, CsCode csBlack) {
    return {h1, h2, redBudget, blackBudget, csRed, csBlack, color == Color::Red};
}

void rememberMateWitness(MateSearchState& st, i32 h1, i32 h2, int redBudget, int blackBudget,
                         Color color, CsCode csRed, CsCode csBlack, i32 bestCode, i32 score) {
    if (!bestCode || (score <= MATE_THRESHOLD && score >= -MATE_THRESHOLD)) return;
    MateWitnessKey key = witnessKey(h1, h2, redBudget, blackBudget, color, csRed, csBlack);
    if (st.mateWitness.size() >= MATE_WITNESS_LIMIT && st.mateWitness.find(key) == st.mateWitness.end()) return;
    st.mateWitness.emplace(key, bestCode);
}

bool witnessKtcSkip(const Board& board, const Move& move, Color color, const MateSearchState& st) {
    if (!st.ktcBudgetOn || st.ktcExemptColor == Color::None || color != st.ktcExemptColor) return false;
    const Piece& piece = board[move.from.row][move.from.col];
    if (piece.type != PieceType::King || !board[move.to.row][move.to.col].empty()) return false;
    Square king;
    return findKing(board, color, king) && isKingAttacked(board, color, king);
}

bool isKtcBudgetSkip(const ScoredMove& move, Color color, const MateSearchState& st, bool inCheck) {
    if (!st.ktcBudgetOn || st.ktcExemptColor == Color::None || color != st.ktcExemptColor) return false;
    if (move.piece.type != PieceType::King) return false;
    if (!move.captured.empty()) return false;
    return inCheck;
}

}  // namespace

SearchResult negamaxForcedMateGen(Board& b, Color color, int redBudget, int blackBudget,
                                    int pliesFromRoot, i32 alpha, i32 beta,
                                    i32 h1, i32 h2, CsCode csRed, CsCode csBlack,
                                    MateSearchState& st) {
    ++st.nodeCounter;

    // Kiểm tra huỷ/hết giờ ở MỖI nút. Một vài thế rất hẹp có thể mắc lâu trong
    // cùng một nhánh sâu; kiểm tra mỗi 4096 nút khiến `stop`/`movetime` không
    // phản hồi và khóa toàn bộ hàng cache.
    // Kết quả trả về ở đây KHÔNG được tin — runGoBudget phải tự nhận ra mức budget này bị cắt dở
    // (qua st.timeUp() sau khi gọi xong) và bỏ, không báo cáo như một mức đã quét cạn thật.
    if (st.isCancelled() || st.timeUp()) return {0, {}};

    int myBudget = (color == Color::Red) ? redBudget : blackBudget;
    if (myBudget <= 0) {
        // Khớp :3306: hết ngân sách nước của bên này thì chốt bằng đánh giá tĩnh, KHÔNG mở rộng
        // quiescence — quirk có chủ đích của bản gốc, phải giữ nguyên để kết quả khớp.
        return {evalForColorStatic(b, color), {}};
    }

    // Cắt tỉa theo khoảng cách chiếu bí — khớp :3311-3317. KHÔNG đổi kết quả (chỉ thu hẹp cửa sổ
    // về đúng biên mà điểm chiếu bí không thể vượt qua ở độ sâu này).
    i32 mateCeil = MATE_SCORE - pliesFromRoot;
    if (beta > mateCeil) beta = mateCeil;
    if (alpha < -mateCeil) alpha = -mateCeil;
    if (alpha >= beta) return {alpha, {}};

    bool isRed = color == Color::Red;
    int ply = pliesFromRoot < MATE_MAX_PLY ? pliesFromRoot : MATE_MAX_PLY - 1;
    i32 alphaAtEntry = alpha, betaAtEntry = beta;

    i32 kh1 = csMixH1(h1, csRed, csBlack), kh2 = csMixH2(h2, csRed, csBlack);
    i32 ttCode = 0;
    TranspositionTable::Entry hit;
    if (st.tt.lookup(kh1, kh2, redBudget, blackBudget, isRed, pliesFromRoot, hit)) {
        ttCode = hit.code;
        if (hit.flag == TTFlag::Exact) return {hit.score, {}};
        if (hit.flag == TTFlag::Lower && hit.score >= beta) return {hit.score, {}};
        if (hit.flag == TTFlag::Upper && hit.score <= alpha) return {hit.score, {}};
    }

    std::vector<ScoredMove> moves = pseudoScoredMoves(b, color);
    orderMovesForMate(moves, ttCode, ply, st);

    i32 best = -SEARCH_INF;
    std::vector<Move> bestLine;
    i32 bestCode = 0;
    int legalCount = 0;
    Color opp = otherColor(color);
    Square kingSquare;
    // Một nhánh có thể vừa ăn Tướng đối phương (bản movegen cũ vẫn cho phép
    // nước này lọt vào cây). Khi đó đây là trạng thái thua của bên đang tới
    // lượt; tuyệt đối không dùng kingSquare chưa được khởi tạo để dò bị chiếu.
    if (!findKing(b, color, kingSquare)) return {-(MATE_SCORE - pliesFromRoot), {}};
    bool inCheckNow = isKingAttacked(b, color, kingSquare);
    Square oppKing;
    bool haveOppKing = csRestricted(st.restrictedSide, color) && findKing(b, opp, oppKing);  // khớp :3344
    CsCode myStreak = isRed ? csRed : csBlack;

    for (const ScoredMove& move : moves) {
        bool ktcSkip = isKtcBudgetSkip(move, color, st, inCheckNow);
        Piece captured = makeMoveInPlace(b, move);

        Square myKing = (move.piece.type == PieceType::King) ? move.to : kingSquare;
        if (isKingAttacked(b, color, myKing)) { undoMoveInPlace(b, move, captured); continue; }
        ++legalCount;

        i32 score;
        bool haveRes = false;
        SearchResult res;
        CsCode nextCsR = csRed, nextCsB = csBlack;
        bool brokeRule = false;

        if (haveOppKing) {
            CsCode ncs = csAdvanceAfterMove(b, myStreak, move, color, oppKing,
                                            st.restrictedSide, st.checkStreakLimit);
            if (ncs < 0) {
                brokeRule = true;
                score = -(MATE_SCORE - (pliesFromRoot + 1));
            } else if (isRed) nextCsR = ncs; else nextCsB = ncs;
        }

        if (!brokeRule) {
            int consume = ktcSkip ? 0 : 1;
            int nextRed = isRed ? redBudget - consume : redBudget;
            int nextBlack = isRed ? blackBudget : blackBudget - consume;

            int fromSq = squareIndex(move.from), toSq = squareIndex(move.to);
            HashPair fromZ = pieceZobrist(move.piece.type, move.piece.color, fromSq);
            HashPair toZ = pieceZobrist(move.piece.type, move.piece.color, toSq);
            i32 nh1 = h1 ^ fromZ.h1 ^ toZ.h1 ^ g_zobristTurn1;
            i32 nh2 = h2 ^ fromZ.h2 ^ toZ.h2 ^ g_zobristTurn2;
            if (!captured.empty()) {
                HashPair capZ = pieceZobrist(captured.type, captured.color, toSq);
                nh1 ^= capZ.h1; nh2 ^= capZ.h2;
            }

            res = negamaxForcedMateGen(b, opp, nextRed, nextBlack, pliesFromRoot + 1, -beta, -alpha,
                                         nh1, nh2, nextCsR, nextCsB, st);
            haveRes = true;
            score = -res.score;
        }
        undoMoveInPlace(b, move, captured);

        // A cancelled child is not a bound. Never retain it in a warm session.
        if (st.isCancelled() || st.timeUp()) return {0, {}};

        if (score > best) {
            best = score;
            bestCode = moveCode(move.from, move.to) + 1;
            bestLine.clear();
            bestLine.push_back(move);
            if (haveRes) bestLine.insert(bestLine.end(), res.line.begin(), res.line.end());
        }
        if (best > alpha) alpha = best;
        if (alpha >= beta) {
            if (move.captured.empty()) {
                auto& history = st.mateHistoryScores[historyIndex(move)];
                history = static_cast<i32>(std::min<i64>(1'000'000'000LL,
                    static_cast<i64>(history) + static_cast<i64>(redBudget + blackBudget) * (redBudget + blackBudget)));
                i32 code = moveCode(move.from, move.to) + 1;
                if (st.mateKillerA[ply] != code) { st.mateKillerB[ply] = st.mateKillerA[ply]; st.mateKillerA[ply] = code; }
            }
            break;
        }
        // Hết giờ/bị huỷ ngay SAU khi một nhánh con vừa trả về: dừng NGAY tại đây, đừng thử tiếp
        // các nước anh em còn lại ở nút này. Chỉ dựa vào kiểm tra định kỳ ở đầu hàm (mỗi 4096 nút
        // TOÀN CÂY) là không đủ — mỗi tổ tiên gần gốc còn phải duyệt hết các nước anh em CỦA NÓ
        // trước khi tự thấy hết giờ, cộng dồn qua hàng chục cấp thì phần vượt hạn giờ cứ dồn dần
        // (đã thấy thật: xin 3s, tràn tới 15s+ ở thế cờ khai cuộc đủ quân). Kiểm tra ngay tại đây,
        // sau MỖI nước con, chặn đứng việc "rò rỉ" cộng dồn đó ngay từ gốc.
        if (st.isCancelled() || st.timeUp()) break;
    }

    if (legalCount == 0) return {-(MATE_SCORE - pliesFromRoot), {}};

    TTFlag flag = best <= alphaAtEntry ? TTFlag::Upper : (best >= betaAtEntry ? TTFlag::Lower : TTFlag::Exact);
    rememberMateWitness(st, h1, h2, redBudget, blackBudget, color, csRed, csBlack, bestCode, best);
    st.tt.store(kh1, kh2, redBudget, blackBudget, isRed, best, flag, bestCode, pliesFromRoot);
    return {best, bestLine};
}

// Khớp negamaxForcedMateRootSubsetGen (:3418-3461): vòng lặp gốc chỉ xét subsetMoves đã hợp lệ +
// sắp thứ tự sẵn, không tra/ghi TT ở đúng mức gốc, mọi nút CON vẫn dùng negamaxForcedMateGen bình
// thường (kể cả TT của nó) — không đổi kết quả so với chạy đơn luồng.
SearchResult negamaxForcedMateRootSubsetGen(Board& b, Color color, int redBudget, int blackBudget,
                                              const std::vector<Move>& subsetMoves, i32 alpha, i32 beta,
                                              i32 h1, i32 h2, CsCode csRed, CsCode csBlack,
                                              MateSearchState& st) {
    bool isRed = color == Color::Red;
    Color opp = otherColor(color);
    Square kingSquare;
    if (!findKing(b, color, kingSquare)) return {-(MATE_SCORE - 1), {}};
    bool inCheckNow = isKingAttacked(b, color, kingSquare);
    Square oppKing;
    bool haveOppKing = csRestricted(st.restrictedSide, color) && findKing(b, opp, oppKing);
    CsCode myStreak = isRed ? csRed : csBlack;

    i32 best = -SEARCH_INF;
    std::vector<Move> bestLine;
    i32 bestCode = 0;

    for (const Move& mv : subsetMoves) {
        ScoredMove move;
        move.from = mv.from; move.to = mv.to;
        move.piece = b[mv.from.row][mv.from.col];
        move.captured = b[mv.to.row][mv.to.col];

        bool ktcSkip = isKtcBudgetSkip(move, color, st, inCheckNow);
        Piece captured = makeMoveInPlace(b, move);
        ++st.nodeCounter;

        i32 score;
        bool haveRes = false;
        SearchResult res;
        CsCode nextCsR = csRed, nextCsB = csBlack;
        bool brokeRule = false;

        if (haveOppKing) {
            CsCode ncs = csAdvanceAfterMove(b, myStreak, move, color, oppKing,
                                            st.restrictedSide, st.checkStreakLimit);
            if (ncs < 0) {
                brokeRule = true;
                score = -(MATE_SCORE - 1);
            } else if (isRed) nextCsR = ncs; else nextCsB = ncs;
        }

        if (!brokeRule) {
            int consume = ktcSkip ? 0 : 1;
            int nextRed = isRed ? redBudget - consume : redBudget;
            int nextBlack = isRed ? blackBudget : blackBudget - consume;
            int fromSq = squareIndex(move.from), toSq = squareIndex(move.to);
            HashPair fromZ = pieceZobrist(move.piece.type, move.piece.color, fromSq);
            HashPair toZ = pieceZobrist(move.piece.type, move.piece.color, toSq);
            i32 nh1 = h1 ^ fromZ.h1 ^ toZ.h1 ^ g_zobristTurn1;
            i32 nh2 = h2 ^ fromZ.h2 ^ toZ.h2 ^ g_zobristTurn2;
            if (!captured.empty()) {
                HashPair capZ = pieceZobrist(captured.type, captured.color, toSq);
                nh1 ^= capZ.h1; nh2 ^= capZ.h2;
            }
            res = negamaxForcedMateGen(b, opp, nextRed, nextBlack, 1, -beta, -alpha, nh1, nh2, nextCsR, nextCsB, st);
            haveRes = true;
            score = -res.score;
        }
        undoMoveInPlace(b, move, captured);

        if (st.isCancelled() || st.timeUp()) return {0, {}};

        if (score > best) {
            best = score;
            bestCode = moveCode(move.from, move.to) + 1;
            bestLine.clear();
            bestLine.push_back(move);
            if (haveRes) bestLine.insert(bestLine.end(), res.line.begin(), res.line.end());
        }
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
        if (st.isCancelled() || st.timeUp()) break;
    }
    rememberMateWitness(st, h1, h2, redBudget, blackBudget, color, csRed, csBlack, bestCode, best);
    return {best, bestLine};
}

std::vector<Move> rebuildMateWitnessLine(Board board, Color color, int redBudget, int blackBudget,
                                         CsCode csRed, CsCode csBlack, MateSearchState& st) {
    HashPair hp = hashBoardPair(board);
    i32 h1 = hp.h1, h2 = hp.h2;
    std::vector<Move> line;

    for (int ply = 0; ply < MATE_MAX_PLY; ++ply) {
        std::vector<Move> legal;
        generateLegalMoves(board, color, legal);
        if (legal.empty()) return line.empty() ? std::vector<Move>{} : line;

        const MateWitnessKey key = witnessKey(h1, h2, redBudget, blackBudget, color, csRed, csBlack);
        const auto hit = st.mateWitness.find(key);
        if (hit == st.mateWitness.end() || hit->second <= 0) return {};

        const int rawCode = hit->second - 1;
        const int fromIndex = rawCode / ZOBRIST_SQUARES;
        const int toIndex = rawCode % ZOBRIST_SQUARES;
        const auto moveIt = std::find_if(legal.begin(), legal.end(), [&](const Move& move) {
            return squareIndex(move.from) == fromIndex && squareIndex(move.to) == toIndex;
        });
        if (moveIt == legal.end()) return {};

        const Move move = *moveIt;
        const Piece moved = board[move.from.row][move.from.col];
        const bool ktcSkip = witnessKtcSkip(board, move, color, st);
        const Color opp = otherColor(color);
        Square oppKing;
        const bool trackStreak = csRestricted(st.restrictedSide, color) && findKing(board, opp, oppKing);
        const CsCode oldStreak = color == Color::Red ? csRed : csBlack;
        const Piece captured = makeMoveInPlace(board, move);

        if (trackStreak) {
            const CsCode nextStreak = csAdvanceAfterMove(board, oldStreak, move, color, oppKing,
                                                          st.restrictedSide, st.checkStreakLimit);
            if (nextStreak < 0) return {};
            if (color == Color::Red) csRed = nextStreak; else csBlack = nextStreak;
        }
        if (!ktcSkip) {
            if (color == Color::Red) --redBudget; else --blackBudget;
        }
        if (redBudget < 0 || blackBudget < 0) return {};

        const int fromSq = squareIndex(move.from), toSq = squareIndex(move.to);
        const HashPair fromZ = pieceZobrist(moved.type, moved.color, fromSq);
        const HashPair toZ = pieceZobrist(moved.type, moved.color, toSq);
        h1 ^= fromZ.h1 ^ toZ.h1 ^ g_zobristTurn1;
        h2 ^= fromZ.h2 ^ toZ.h2 ^ g_zobristTurn2;
        if (!captured.empty()) {
            const HashPair capZ = pieceZobrist(captured.type, captured.color, toSq);
            h1 ^= capZ.h1;
            h2 ^= capZ.h2;
        }
        line.push_back(move);
        color = opp;
    }
    return {};
}

std::vector<Move> forcedMateRootMoves(Board& b, Color color, MateSearchState& st) {
    std::vector<ScoredMove> scored = pseudoScoredMoves(b, color);
    orderMovesForMate(scored, 0, 0, st);

    Square kingSquare;
    if (!findKing(b, color, kingSquare)) return {};

    std::vector<Move> out;
    out.reserve(scored.size());
    for (const ScoredMove& move : scored) {
        Piece captured = makeMoveInPlace(b, move);
        Square myKing = (move.piece.type == PieceType::King) ? move.to : kingSquare;
        bool legal = !isKingAttacked(b, color, myKing);
        undoMoveInPlace(b, move, captured);
        if (legal) out.push_back(move);
    }
    return out;
}

// Khớp probeForcedMateAlphaBetaGen (:3689-3704). Khi ktc: ngân sách bên thủ nới slack.
ProbeResult probeForcedMateAlphaBetaGen(Board& b, Color color, int redBudget, int blackBudget,
                                          CsCode csRed, CsCode csBlack, MateSearchState& st) {
    HashPair hp = hashBoardPair(b);
    Color savedExempt = st.ktcExemptColor;
    Color opp = otherColor(color);

    int winRed = redBudget, winBlack = blackBudget;
    ktcSearchBudgets(color, redBudget, blackBudget, st.ktcBudgetOn, winRed, winBlack);
    st.ktcExemptColor = color;
    SearchResult win = negamaxForcedMateGen(b, color, winRed, winBlack, 0, MATE_THRESHOLD, MATE_SCORE,
                                              hp.h1, hp.h2, csRed, csBlack, st);
    if (win.score > MATE_THRESHOLD) { st.ktcExemptColor = savedExempt; return {true, win.score, win.line}; }

    int lossRed = redBudget, lossBlack = blackBudget;
    ktcSearchBudgets(opp, redBudget, blackBudget, st.ktcBudgetOn, lossRed, lossBlack);
    st.ktcExemptColor = opp;
    SearchResult loss = negamaxForcedMateGen(b, color, lossRed, lossBlack, 0, -MATE_SCORE, -MATE_THRESHOLD,
                                               hp.h1, hp.h2, csRed, csBlack, st);
    st.ktcExemptColor = savedExempt;
    if (loss.score < -MATE_THRESHOLD) return {true, loss.score, loss.line};

    return {false, 0, {}};
}

}  // namespace BruteForce
