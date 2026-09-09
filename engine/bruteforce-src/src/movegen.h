#ifndef BRUTEFORCE_MOVEGEN_H
#define BRUTEFORCE_MOVEGEN_H

#include "types.h"
#include <vector>

namespace BruteForce {

// Khớp findKing() (:1230-1245): quét cung 3x3 trước, rồi mới quét cả bàn (phòng thế cờ dựng tay sai).
bool findKing(const Board& b, Color color, Square& out);

// Khớp kingsFacing() (:1339-1346): luật "lộ mặt tướng".
bool kingsFacing(const Board& b);

// Khớp isKingAttacked()/isInCheck() (:1357-1407).
bool isKingAttacked(const Board& b, Color color, Square kingSq);
inline bool isInCheck(const Board& b, Color color, const Square& kingSq) {
    return isKingAttacked(b, color, kingSq);
}

// Khớp collectCheckerSquares() của app: chỉ số ô của MỌI quân đang chiếu Tướng bên `color`, xếp
// TĂNG DẦN. Cùng bộ luật ăn quân với isKingAttacked, chỉ khác là thu hết thay vì thoát ngay ở quân
// đầu tiên. Luật chiếu liên tục cần biết đích danh quân nào đang chiếu (chiếu đôi thì cả hai).
// Trả về số quân tìm được, ghi vào out[] (đủ chỗ cho mọi trường hợp: tối đa 10 quân có thể chiếu).
int collectCheckerSquares(const Board& b, Color color, Square kingSq, int* out);

// Khớp getPseudoMoves() (:1259-1337): sinh nước pseudo-legal cho MỘT quân tại (row,col).
void getPseudoMoves(const Board& b, int row, int col, std::vector<Move>& out);

// Khớp generatePseudoMoveList() (:1424-1439): pseudo-legal cho CẢ MỘT bên (lọc hợp lệ tại điểm dùng).
void generatePseudoMoveList(const Board& b, Color color, std::vector<Move>& out);

// Khớp generateLegalMoves() (:1441-1458): lọc hợp lệ đầy đủ (không để lộ Tướng mình).
void generateLegalMoves(const Board& b, Color color, std::vector<Move>& out);

// makeMoveInPlace/undoMoveInPlace (:1409-1419): đổi tại chỗ, trả lại quân bị ăn để undo.
Piece makeMoveInPlace(Board& b, const Move& m);
void undoMoveInPlace(Board& b, const Move& m, Piece captured);

}  // namespace BruteForce

#endif  // BRUTEFORCE_MOVEGEN_H
