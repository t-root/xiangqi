#ifndef BRUTEFORCE_HASH_H
#define BRUTEFORCE_HASH_H

#include "types.h"

namespace BruteForce {

struct HashPair { i32 h1, h2; };

// Khớp seedZobrist() (:1499-1508): PRNG xorshift32 hạt giống cố định 0x9E3779B9, dùng int32 có dấu.
// Không bắt buộc phải khớp giá trị TUYỆT ĐỐI với bản JS (TT chỉ là cache tốc độ, không đổi kết
// quả cuối) nhưng tự seed cố định để mỗi lần chạy đều tái lập được, đúng tinh thần bản gốc.
void initZobrist();

// Khớp ZOBRIST_INDEX (:1486-1489): thứ tự cố định loại quân dùng làm chỉ số bảng băm.
int zobristPieceIndex(PieceType type, Color color);

HashPair hashBoardPair(const Board& b);  // khớp hashBoardPair() (:1550-1561)

// Khoá Zobrist của MỘT quân tại MỘT ô — dùng để cập nhật băm tăng dần theo từng nước đi (khớp
// cách negamaxForcedMateGen tự XOR trực tiếp ZOBRIST_H1/H2 thay vì hash lại toàn bàn, :3375-3382).
HashPair pieceZobrist(PieceType type, Color color, int square);

extern i32 g_zobristTurn1, g_zobristTurn2;  // khớp ZOBRIST_TURN1/2 (:1509)

// ===== Chuỗi chiếu: khớp csCountAt/csMaxCount/csMixH1/csMixH2 của app =====
// Số nước chiếu liên tiếp của quân đang đứng ở ô `sq`; 0 nếu ô đó không giữ chuỗi. Đọc thẳng trên
// số đã gói, không dựng mảng — hàm này chạy trong vòng tìm kiếm.
inline int csCountAt(CsCode code, int sq) {
    while (code > 0) {
        int digit = int(code % CS_DIGIT_BASE);
        code /= CS_DIGIT_BASE;
        if (digit > 0 && digit / CS_COUNT_BASE == sq) return digit % CS_COUNT_BASE;
    }
    return 0;
}

// Số nước liên tiếp cao nhất trong trạng thái — chỉ dùng để in ra khi gỡ lỗi.
inline int csMaxCount(CsCode code) {
    int best = 0;
    while (code > 0) {
        int digit = int(code % CS_DIGIT_BASE);
        code /= CS_DIGIT_BASE;
        if (digit > 0 && digit % CS_COUNT_BASE > best) best = digit % CS_COUNT_BASE;
    }
    return best;
}

i32 csMixH1(i32 h1, CsCode csRed, CsCode csBlack);
i32 csMixH2(i32 h2, CsCode csRed, CsCode csBlack);

}  // namespace BruteForce

#endif  // BRUTEFORCE_HASH_H
