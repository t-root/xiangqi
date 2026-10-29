#include "hash.h"

namespace BruteForce {

namespace {
constexpr int NUM_PIECE_TYPES = 14;  // 7 loại x 2 màu, khớp ZOBRIST_INDEX
i32 ZOBRIST_H1[NUM_PIECE_TYPES * NUM_SQUARES];
i32 ZOBRIST_H2[NUM_PIECE_TYPES * NUM_SQUARES];
// Một khoá cho mỗi cặp (ô, số lần) của mỗi bên; trạng thái nhiều quân thì XOR các khoá lại.
i32 ZOBRIST_CSR1[CS_ENTRY_CODES];
i32 ZOBRIST_CSR2[CS_ENTRY_CODES];
i32 ZOBRIST_CSB1[CS_ENTRY_CODES];
i32 ZOBRIST_CSB2[CS_ENTRY_CODES];

// xorshift32, khớp seedZobrist() (:1501-1502): s^=s<<13; s^=s>>>17; s^=s<<5 (int32 có dấu).
struct XorShift32 {
    uint32_t s;
    int32_t next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return static_cast<int32_t>(s);
    }
};
}  // namespace

i32 g_zobristTurn1 = static_cast<i32>(0x5BD1E995u);  // :1509
i32 g_zobristTurn2 = static_cast<i32>(0x27D4EB2Fu);

int zobristPieceIndex(PieceType type, Color color) {
    // Khớp thứ tự ZOBRIST_INDEX: red 0..6 (Soldier,Horse,Chariot,Cannon,Elephant,Advisor,King),
    // black 7..13 cùng thứ tự.
    static const int order[8] = {-1, 0, 1, 2, 3, 5, 4, 6};  // PieceType -> vị trí trong nhóm 7 (Soldier=1..King=7)
    int base = order[static_cast<int>(type)];
    return (color == Color::Black ? 7 : 0) + base;
}

void initZobrist() {
    // Thứ tự sinh số: H1[i] rồi H2[i] xen kẽ từng ô, khớp vòng lặp gốc "H1[i]=rnd(); H2[i]=rnd();".
    XorShift32 rng{0x9E3779B9u};
    for (int i = 0; i < NUM_PIECE_TYPES * NUM_SQUARES; ++i) {
        ZOBRIST_H1[i] = rng.next();
        ZOBRIST_H2[i] = rng.next();
    }
    ZOBRIST_CSR1[0] = ZOBRIST_CSR2[0] = ZOBRIST_CSB1[0] = ZOBRIST_CSB2[0] = 0;
    for (int i = 1; i < CS_ENTRY_CODES; ++i) {
        ZOBRIST_CSR1[i] = rng.next(); ZOBRIST_CSR2[i] = rng.next();
        ZOBRIST_CSB1[i] = rng.next(); ZOBRIST_CSB2[i] = rng.next();
    }
}

HashPair hashBoardPair(const Board& b) {
    i32 h1 = 0, h2 = 0;
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            const Piece& p = b[r][c];
            if (p.empty()) continue;
            int idx = zobristPieceIndex(p.type, p.color) * NUM_SQUARES + squareIndex(r, c);
            h1 ^= ZOBRIST_H1[idx];
            h2 ^= ZOBRIST_H2[idx];
        }
    return {h1, h2};
}

// Trộn từng cặp (ô, số lần) một; XOR nên thứ tự không quan trọng. Trạng thái rỗng không trộn gì —
// khi chưa ai chiếu liên tiếp, mã băm giống hệt bản chưa có luật này (khớp csMixOne của app).
namespace {
i32 csMixOne(i32 h, CsCode code, const i32* table) {
    while (code > 0) {
        int digit = int(code % CS_DIGIT_BASE);
        code /= CS_DIGIT_BASE;
        if (digit > 0) h ^= table[digit];
    }
    return h;
}
}  // namespace

i32 csMixH1(i32 h1, CsCode csRed, CsCode csBlack) {
    if (!csRed && !csBlack) return h1;
    return csMixOne(csMixOne(h1, csRed, ZOBRIST_CSR1), csBlack, ZOBRIST_CSB1);
}
i32 csMixH2(i32 h2, CsCode csRed, CsCode csBlack) {
    if (!csRed && !csBlack) return h2;
    return csMixOne(csMixOne(h2, csRed, ZOBRIST_CSR2), csBlack, ZOBRIST_CSB2);
}

HashPair pieceZobrist(PieceType type, Color color, int square) {
    int idx = zobristPieceIndex(type, color) * NUM_SQUARES + square;
    return {ZOBRIST_H1[idx], ZOBRIST_H2[idx]};
}

}  // namespace BruteForce
