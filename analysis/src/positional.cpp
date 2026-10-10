// Cổng chính xác orderMoves/quiescenceGen/negamaxPositionalGen/positionalRootGen
// (xiangqi-analyzer.html:1470-1480, 1890-1994). Bỏ generator/yield JS (không cần cho native thread).

#include "positional.h"
#include "eval.h"
#include <algorithm>
#include <limits>

namespace BruteForce {

namespace {
i64 moveOrderScore(const ScoredMoveP& m, const PositionalSearchState& st) {  // khớp :1470-1476
    if (!m.captured.empty()) {
        return 10'000'000LL + static_cast<i64>(pieceValue(m.captured.type)) * 100 - pieceValue(m.piece.type);
    }
    return st.historyScores[historyIndex(m)];
}

std::vector<ScoredMoveP> legalScoredMoves(const Board& b, Color color) {
    std::vector<Move> raw;
    raw.reserve(128);
    generateLegalMoves(b, color, raw);
    std::vector<ScoredMoveP> out;
    out.reserve(raw.size());
    for (const Move& m : raw) {
        ScoredMoveP sm;
        sm.from = m.from; sm.to = m.to;
        sm.piece = b[m.from.row][m.from.col];
        sm.captured = b[m.to.row][m.to.col];
        out.push_back(sm);
    }
    return out;
}
}  // namespace

void orderMoves(std::vector<ScoredMoveP>& moves, const PositionalSearchState& st) {
    for (auto& m : moves) m.ord = moveOrderScore(m, st);
    std::sort(moves.begin(), moves.end(), [](const ScoredMoveP& a, const ScoredMoveP& b) { return a.ord > b.ord; });
}

i32 quiescence(Board& b, Color color, i32 alpha, i32 beta, int depth, int ply,
                CsCode csRed, CsCode csBlack, PositionalSearchState& st) {
    ++st.nodeCounter;
    if ((st.cancelled && st.cancelled->load(std::memory_order_relaxed)) || st.timeUp()) return 0;

    Square kingSq;
    bool haveKing = findKing(b, color, kingSq);
    bool inCheck = haveKing && isKingAttacked(b, color, kingSq);
    if (!inCheck) {
        i32 stand = evaluateForColor(b, color);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (depth <= 0) return alpha;
    }

    std::vector<ScoredMoveP> legal = legalScoredMoves(b, color);
    if (legal.empty()) return -(MATE_SCORE - ply);
    if (inCheck && depth <= 0) return evaluateForColor(b, color);

    Color opp = otherColor(color);
    if (inCheck) {
        orderMoves(legal, st);
        for (const ScoredMoveP& move : legal) {
            Piece captured = makeMoveInPlace(b, move);
            CheckStreakResult nx = nextCheckStreakAfterMove(b, color, move, csRed, csBlack, ply, st.restrictedSide, st.checkStreakLimit);
            i32 score = nx.brokeRule ? nx.score
                : -quiescence(b, opp, -beta, -alpha, depth - 1, ply + 1, nx.csRed, nx.csBlack, st);
            undoMoveInPlace(b, move, captured);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    std::vector<ScoredMoveP> moves;
    moves.reserve(legal.size());
    for (const auto& move : legal) if (!move.captured.empty()) moves.push_back(move);
    if (moves.empty()) return alpha;
    orderMoves(moves, st);
    for (const ScoredMoveP& move : moves) {
        Piece captured = makeMoveInPlace(b, move);
        CheckStreakResult nx = nextCheckStreakAfterMove(b, color, move, csRed, csBlack, ply, st.restrictedSide, st.checkStreakLimit);
        i32 score = nx.brokeRule ? nx.score
            : -quiescence(b, opp, -beta, -alpha, depth - 1, ply + 1, nx.csRed, nx.csBlack, st);
        undoMoveInPlace(b, move, captured);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    return alpha;
}

i32 negamaxPositional(Board& b, Color color, int depth, i32 alpha, i32 beta, int ply,
                        CsCode csRed, CsCode csBlack, PositionalSearchState& st) {
    ++st.nodeCounter;
    if ((st.cancelled && st.cancelled->load(std::memory_order_relaxed)) || st.timeUp()) return 0;

    std::vector<ScoredMoveP> moves = legalScoredMoves(b, color);
    if (moves.empty()) return -(MATE_SCORE - ply);
    if (depth <= 0) return quiescence(b, color, alpha, beta, QUIESCENCE_MAX_DEPTH, ply, csRed, csBlack, st);

    orderMoves(moves, st);
    Color opp = otherColor(color);
    i32 best = -SEARCH_INF;
    for (const ScoredMoveP& move : moves) {
        Piece captured = makeMoveInPlace(b, move);
        CheckStreakResult nx = nextCheckStreakAfterMove(b, color, move, csRed, csBlack, ply, st.restrictedSide, st.checkStreakLimit);
        i32 score = nx.brokeRule ? nx.score
            : -negamaxPositional(b, opp, depth - 1, -beta, -alpha, ply + 1, nx.csRed, nx.csBlack, st);
        undoMoveInPlace(b, move, captured);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) {
            if (move.captured.empty()) st.historyScores[historyIndex(move)] += depth * depth;
            break;
        }
        // Cùng lý do với negamaxForcedMateGen (search.cpp): kiểm tra định kỳ mỗi 4096 nút TOÀN CÂY
        // ở đầu hàm không đủ — mỗi tổ tiên gần gốc còn phải duyệt hết nước anh em CỦA NÓ trước khi
        // tự nhận ra hết giờ, cộng dồn qua nhiều cấp thì phần vượt hạn giờ cứ dồn dần. Kiểm tra
        // ngay sau MỖI nước con chặn đứng việc đó từ gốc.
        if ((st.cancelled && st.cancelled->load(std::memory_order_relaxed)) || st.timeUp()) break;
    }
    return best;
}

PositionalRootResult positionalRoot(Board& b, Color color, int depth, const std::vector<Move>& orderedMoves,
                                      CsCode csRed, CsCode csBlack, PositionalSearchState& st) {
    PositionalRootResult result;
    if (orderedMoves.empty()) return result;
    Color opp = otherColor(color);
    i32 alpha = -SEARCH_INF;

    for (const Move& mv : orderedMoves) {
        if ((st.cancelled && st.cancelled->load(std::memory_order_relaxed)) || st.timeUp()) break;
        ScoredMoveP move;
        move.from = mv.from; move.to = mv.to;
        move.piece = b[mv.from.row][mv.from.col];
        move.captured = b[mv.to.row][mv.to.col];

        Piece captured = makeMoveInPlace(b, move);
        CheckStreakResult nx = nextCheckStreakAfterMove(b, color, move, csRed, csBlack, 0, st.restrictedSide, st.checkStreakLimit);
        i32 raw = nx.brokeRule ? nx.score
            : -negamaxPositional(b, opp, depth - 1, -SEARCH_INF, -alpha, 1, nx.csRed, nx.csBlack, st);

        i32 penalty = 0;
        if (st.history && !st.history->empty()) {
            HashPair hp = hashBoardPair(b);
            RepetitionEntry key{hp.h1, hp.h2, opp, color, false};
            penalty = repetitionPenalty(*st.history, key);
            // Nước đang chiếu mà lặp lại một thế đã gặp là đang bước vào vòng "chiếu mãi": luật xử
            // THUA bên chiếu, KỂ CẢ khi bên kia mới là người khép vòng lặp (nên repetitionPenalty ở
            // trên không bắt được — nó chỉ đo lần lặp của chính thế cờ này). Đợi tới nước cuối mới
            // tránh thì đã muộn, phạt ngay từ lần lặp đầu để đổi kế hoạch từ sớm.
            Square oppKing;
            if (findKing(b, opp, oppKing) && isKingAttacked(b, opp, oppKing)
                && st.history->countMatches(key) >= 1) {
                penalty += PERPETUAL_CHECK_PENALTY;
            }
        }
        i32 score = raw - penalty;
        undoMoveInPlace(b, move, captured);

        if (!result.hasMove || score > result.score) {
            result.hasMove = true; result.score = score; result.rawScore = raw; result.move = move;
        }
        if (score > alpha) alpha = score;
    }
    return result;
}

}  // namespace BruteForce
