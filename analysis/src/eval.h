#ifndef BRUTEFORCE_EVAL_H
#define BRUTEFORCE_EVAL_H

#include "types.h"

namespace BruteForce {

// Khớp buildPieceSquareTables/pieceSquareBonus/evaluatePosition/evaluateForColor
// (xiangqi-analyzer.html:1693-1758) — hằng số PHẢI giữ nguyên byte-for-byte.
void initEvalTables();  // gọi một lần lúc khởi động (build bảng điểm vị trí)

i32 evaluatePosition(const Board& b);          // điểm dương = Đỏ đang lợi
i32 evaluateForColor(const Board& b, Color c);

// Tên khớp với chỗ gọi trong search.cpp (negamaxForcedMateGen dùng evaluateForColor khi hết
// ngân sách nước — đặt bí danh rõ nghĩa "đánh giá tĩnh" cho dễ đọc tại điểm gọi đó).
inline i32 evalForColorStatic(const Board& b, Color c) { return evaluateForColor(b, c); }

}  // namespace BruteForce

#endif  // BRUTEFORCE_EVAL_H
