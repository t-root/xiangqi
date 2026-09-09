#include "rules.h"

namespace BruteForce {

// Khớp hasAnyLegalMove (:1538-1548): dừng ngay khi tìm được MỘT nước hợp lệ, không liệt kê hết.
bool hasAnyLegalMove(const Board& b, Color color) {
    Square kingSq;
    if (!findKing(b, color, kingSq)) return false;
    Board scratch = b;
    std::vector<Move> pseudo;
    generatePseudoMoveList(scratch, color, pseudo);
    for (const Move& m : pseudo) {
        Piece captured = makeMoveInPlace(scratch, m);
        Square myKing = (scratch[m.to.row][m.to.col].type == PieceType::King) ? m.to : kingSq;
        bool ok = !isKingAttacked(scratch, color, myKing);
        undoMoveInPlace(scratch, m, captured);
        if (ok) return true;
    }
    return false;
}

}  // namespace BruteForce
