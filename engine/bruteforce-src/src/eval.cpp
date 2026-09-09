// Cổng chính xác buildPieceSquareTables/pieceSquareBonus/evaluatePosition/evaluateForColor
// (xiangqi-analyzer.html:1693-1758). Mọi hằng số giữ nguyên — đây là hàm quyết định điểm số nên
// đổi dù 1 đơn vị cũng làm sai kết quả so sánh với bản JS.

#include "eval.h"
#include <array>
#include <cmath>

namespace BruteForce {

namespace {
using Table = std::array<std::array<i32, BOARD_WIDTH>, BOARD_HEIGHT>;
Table g_soldier{}, g_horse{}, g_chariot{}, g_cannon{}, g_advisor{}, g_elephant{}, g_king{};

const Table& tableFor(PieceType t) {
    switch (t) {
        case PieceType::Soldier:  return g_soldier;
        case PieceType::Horse:    return g_horse;
        case PieceType::Chariot:  return g_chariot;
        case PieceType::Cannon:   return g_cannon;
        case PieceType::Advisor:  return g_advisor;
        case PieceType::Elephant: return g_elephant;
        default:                  return g_king;  // King và None (None không tra bảng vì empty() đã lọc trước)
    }
}
}  // namespace

void initEvalTables() {
    for (int r = 0; r < BOARD_HEIGHT; ++r) {
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            int centerCol = 4 - std::abs(c - 4);   // 0..4, khớp :1699
            bool crossed = r <= 4;                 // khớp :1700 (Tốt Đỏ đã qua sông)

            g_soldier[r][c] = crossed ? (90 + (4 - r) * 22 + centerCol * 6) : (r == 5 ? 10 : 0);  // :1703
            g_horse[r][c] = centerCol * 6 + (r <= 5 ? 12 : 0)                                      // :1706-1708
                - ((c == 0 || c == BOARD_WIDTH - 1) ? 16 : 0)
                - ((r == 0 || r == BOARD_HEIGHT - 1) ? 12 : 0);
            g_chariot[r][c] = centerCol * 4 + (crossed ? 18 : 0);        // :1711
            g_cannon[r][c] = centerCol * 5 + ((r >= 2 && r <= 5) ? 12 : 0);  // :1714
        }
    }

    // Sĩ/Tượng/Tướng — khớp :1719-1727 (toạ độ [row,col] y hệt bản JS).
    for (auto& rc : {std::pair{9, 3}, {9, 5}, {7, 3}, {7, 5}}) g_advisor[rc.first][rc.second] = 12;
    g_advisor[8][4] = 22;
    for (auto& rc : {std::pair{9, 2}, {9, 6}, {7, 0}, {7, 8}, {5, 2}, {5, 6}}) g_elephant[rc.first][rc.second] = 12;
    g_elephant[7][4] = 22;

    g_king[9][4] = 12; g_king[9][3] = 6; g_king[9][5] = 6;
    g_king[8][3] = -8; g_king[8][5] = -8;
    g_king[7][3] = -22; g_king[7][4] = -16; g_king[7][5] = -22;
}

namespace {
// Khớp pieceSquareBonus (:1734-1738): Đen dùng CHÍNH bảng của Đỏ, soi gương qua tâm bàn cờ.
i32 pieceSquareBonus(PieceType type, Color color, int r, int c) {
    if (type == PieceType::None) return 0;
    const Table& table = tableFor(type);
    if (color == Color::Red) return table[r][c];
    return table[BOARD_HEIGHT - 1 - r][BOARD_WIDTH - 1 - c];
}
}  // namespace

i32 evaluatePosition(const Board& b) {
    i32 score = 0;
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            const Piece& p = b[r][c];
            if (p.empty()) continue;
            i32 v = pieceValue(p.type) + pieceSquareBonus(p.type, p.color, r, c);
            score += (p.color == Color::Red ? v : -v);
        }
    return score;
}

i32 evaluateForColor(const Board& b, Color c) {
    i32 s = evaluatePosition(b);
    return c == Color::Red ? s : -s;
}

}  // namespace BruteForce
