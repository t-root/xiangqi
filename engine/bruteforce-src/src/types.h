// Brute-force — cổng C++ native của "Engine Web" trong xiangqi-analyzer.html.
// Mọi hằng số/quy tắc ở đây PHẢI khớp bit-by-bit với bản JS (xem
// ../xiangqi-analyzer.html, vùng #ENGINE-START/#ENGINE-END)
// — đây là yêu cầu cứng của dự án, không được đổi kết quả để đổi lấy tốc độ.

#ifndef BRUTEFORCE_TYPES_H
#define BRUTEFORCE_TYPES_H

#include <cstdint>
#include <array>
#include <string>

namespace BruteForce {

using i32 = int32_t;
using i64 = int64_t;
using u16 = uint16_t;
using u32 = uint32_t;

// ===== Bàn cờ: khớp xiangqi-analyzer.html:751-752 =====
constexpr int BOARD_WIDTH = 9;
constexpr int BOARD_HEIGHT = 10;
constexpr int NUM_SQUARES = BOARD_WIDTH * BOARD_HEIGHT;  // 90

enum class Color : uint8_t { Red = 0, Black = 1, None = 2 };
constexpr Color otherColor(Color c) { return c == Color::Red ? Color::Black : Color::Red; }

// Bên bị luật chiếu liên tục áp — khớp checkStreakRestrictedColor của app ('red' | 'black' |
// 'both'), thêm None cho trường hợp tắt luật. Both là bộ luật của chế độ "Duyệt & Điều Khiển":
// CẢ HAI bên cùng bị giới hạn; Red/Black là bộ luật bất đối xứng của chế độ Phân Tích.
enum class CsSide : uint8_t { None = 0, Red = 1, Black = 2, Both = 3 };

constexpr bool csRestricted(CsSide s, Color c) {
    return s == CsSide::Both
        || (s == CsSide::Red && c == Color::Red)
        || (s == CsSide::Black && c == Color::Black);
}

// Loại quân — khớp PIECES/baseType trong JS (đã bỏ tiền tố màu).
enum class PieceType : uint8_t {
    None = 0, Soldier, Horse, Chariot, Cannon, Advisor, Elephant, King
};

struct Piece {
    PieceType type = PieceType::None;
    Color color = Color::None;
    bool empty() const { return type == PieceType::None; }
};

// board[row][col]: row 0 = hàng cuối bên Đen, row 9 = hàng cuối bên Đỏ — khớp
// board[0] là "Black's back rank" (xem boardToXiangqiFen comment, xiangqi-analyzer.html:5591-5593).
using Board = std::array<std::array<Piece, BOARD_WIDTH>, BOARD_HEIGHT>;

struct Square {
    int row, col;
    bool operator==(const Square& o) const { return row == o.row && col == o.col; }
};

inline int squareIndex(int row, int col) { return row * BOARD_WIDTH + col; }
inline int squareIndex(Square s) { return squareIndex(s.row, s.col); }

// Khớp moveCode() trong JS (:1511-1512): from*90+to, dùng làm mã nước gọn cho TT/killer/root-split.
constexpr int ZOBRIST_SQUARES = NUM_SQUARES;  // 90
inline int moveCode(Square from, Square to) {
    return squareIndex(from) * ZOBRIST_SQUARES + squareIndex(to);
}

struct Move {
    Square from{-1, -1};
    Square to{-1, -1};
    bool isNull() const { return from.row < 0; }
    bool operator==(const Move& o) const { return from == o.from && to == o.to; }
};
constexpr Move NULL_MOVE{};

// Khớp historyIndex() (:1464-1466) — dùng chung cho cả bảng lịch sử quét cạn VÀ thế trận (hai
// bảng dữ liệu tách riêng theo state, nhưng cùng công thức chỉ số này).
inline int historyIndex(const Move& m) { return squareIndex(m.from) * NUM_SQUARES + squareIndex(m.to); }

inline bool inBounds(int r, int c) {
    return r >= 0 && r < BOARD_HEIGHT && c >= 0 && c < BOARD_WIDTH;
}

// Khớp inPalace() (:1225): cung là cột 3..5; hàng 7..9 Đỏ, 0..2 Đen.
inline bool inPalace(int r, int c, Color color) {
    if (c < 3 || c > 5) return false;
    return color == Color::Red ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
}

// ===== Giá trị quân — khớp PIECE_VALUES (:878-881) =====
inline int pieceValue(PieceType t) {
    switch (t) {
        case PieceType::Soldier:  return 100;
        case PieceType::Advisor:  return 200;
        case PieceType::Elephant: return 200;
        case PieceType::Horse:    return 400;
        case PieceType::Cannon:   return 450;
        case PieceType::Chariot:  return 900;
        default: return 0;  // King = 0, None = 0
    }
}

// ===== Hằng số tìm kiếm — khớp engine region 1 (xiangqi-analyzer.html:750-798) =====
constexpr int MATE_SCORE = 100000;          // :761
constexpr int MATE_THRESHOLD = 50000;       // :762

// "Vô cực an toàn" — bản JS dùng -Infinity/Infinity (số thực, âm hoá không tràn). C++ dùng int32
// nên KHÔNG được dùng numeric_limits<i32>::min() làm biên: -INT_MIN tràn số (undefined behavior)
// ngay khi bị âm hoá ở nút cha (kiểu -alpha khi truyền beta cho lượt gọi con). INF đủ lớn hơn mọi
// điểm số thật (tối đa ±MATE_SCORE) nhưng âm hoá vẫn nằm gọn trong phạm vi int32.
constexpr i32 SEARCH_INF = MATE_SCORE * 2;
constexpr int UNLIMITED_MAX_BUDGET_PER_SIDE = 60;  // :765
constexpr int AI_MOVE_TIME_LIMIT_MS = 6000;        // :767
constexpr int ASSIST_MAX_THINK_MS = 10000;         // :768
constexpr int MATE_PHASE_TIME_SHARE_NUM = 1, MATE_PHASE_TIME_SHARE_DEN = 4;  // 0.25, :774
constexpr int AI_POSITIONAL_MAX_DEPTH = 12;        // :775
constexpr int QUIESCENCE_MAX_DEPTH = 6;            // :776
constexpr int REPETITION_PENALTY = 60;             // :777
// Phạt nước ĐANG CHIẾU mà lặp lại thế đã gặp — bước đầu của vòng "chiếu mãi", luật xử THUA bên
// chiếu. Nặng hơn phạt lặp thường nhưng vẫn dưới ngưỡng chiếu bí, khớp hằng cùng tên bên app.
constexpr int PERPETUAL_CHECK_PENALTY = 5000;
constexpr int REPETITION_LIMIT = 3;                // :779
constexpr int DRAW_NO_CAPTURE_PLIES = 120;         // :781

// Luật chiếu liên tục — khớp CHECK_STREAK_DEFAULT/CHECK_STREAK_GAME_LIMIT của app. DEFAULT là
// giới hạn của chế độ Phân Tích, GAME_LIMIT của chế độ Duyệt & Điều Khiển; giới hạn thật của một
// lượt "go" do app gửi qua option CheckStreak_Limit.
constexpr int CHECK_STREAK_DEFAULT = 2;
constexpr int CHECK_STREAK_GAME_LIMIT = 3;

// ===== Mã hoá trạng thái chuỗi chiếu của MỘT bên — khớp CS_SLOTS/CS_COUNT_BASE/CS_DIGIT_BASE
// của app (xiangqi-analyzer.html, vùng "Mã hoá trạng thái chuỗi chiếu") =====
// Trạng thái = tập (ô quân đang giữ chuỗi, số nước chiếu liên tiếp của quân đó). Quân giữ chuỗi là
// quân ĐANG THẬT SỰ chiếu Tướng đối phương, nên chiếu đôi thì có nhiều quân cùng giữ chuỗi.
// Gói vào một số nguyên: mỗi quân là một chữ số hệ CS_DIGIT_BASE, digit = ô * CS_COUNT_BASE +
// số_lần (digit 0 = slot trống), các chữ số xếp theo ô TĂNG DẦN nên cùng một tập ra cùng một số.
constexpr int CS_SLOTS = 4;
constexpr int CS_COUNT_BASE = 8;
constexpr int CS_DIGIT_BASE = 1024;
constexpr int CS_ENTRY_CODES = NUM_SQUARES * CS_COUNT_BASE;  // 720

// Trạng thái đã gói. 4 chữ số × 10 bit = 40 bit nên phải là 64-bit (app dùng số thực nguyên chính
// xác, cùng dãy giá trị). CÓ DẤU để dùng được -1 làm dấu hiệu "phạm luật", y như bản JS.
using CsCode = int64_t;

constexpr int TT_BITS = 20;                        // :1563
constexpr int TT_SIZE = 1 << TT_BITS;
constexpr int TT_MASK = TT_SIZE - 1;

constexpr int MATE_MAX_PLY = 128;                  // :1573

enum class TTFlag : uint8_t { Exact = 0, Lower = 1, Upper = 2 };

}  // namespace BruteForce

#endif  // BRUTEFORCE_TYPES_H
