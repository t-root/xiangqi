#ifndef BRUTEFORCE_POSITIONAL_H
#define BRUTEFORCE_POSITIONAL_H

#include "types.h"
#include "movegen.h"
#include "rules.h"
#include "repetition.h"
#include <vector>
#include <atomic>
#include <chrono>
#include <optional>

namespace BruteForce {

// Trạng thái tìm kiếm thế trận — bảng lịch sử RIÊNG với bảng của tìm kiếm quét cạn (khớp ghi chú
// :1571-1572: "không để ảnh hưởng nước máy chọn lúc chơi").
struct PositionalSearchState {
    std::vector<i32> historyScores = std::vector<i32>(NUM_SQUARES * NUM_SQUARES, 0);
    CsSide restrictedSide = CsSide::None;
    int checkStreakLimit = CHECK_STREAK_DEFAULT;
    const PositionHistory* history = nullptr;  // nullptr hoặc rỗng = đang Phân Tích thuần, không phạt lặp thế
    i64 nodeCounter = 0;
    std::atomic<bool>* cancelled = nullptr;  // cùng kiểu/ý nghĩa với MateSearchState::cancelled
    // Hạn giờ THẬT của lượt search — kiểm tra định kỳ CÙNG với cancelled, để một độ sâu đang chạy
    // dở tự dừng đúng hạn mà không cần đợi tín hiệu "stop" từ ngoài (đã thấy lỗi thật: một độ sâu
    // chạy tràn qua hạn giờ hàng giây liền vì vòng lặp NGOÀI chỉ kiểm tra giờ GIỮA các độ sâu).
    std::optional<std::chrono::steady_clock::time_point> deadline;

    bool timeUp() const { return deadline && std::chrono::steady_clock::now() > *deadline; }

    void clearHistoryScores() { std::fill(historyScores.begin(), historyScores.end(), 0); }
};

struct ScoredMoveP : Move {
    Piece piece, captured;
    i64 ord = 0;
};

// Khớp orderMoves (:1470-1480): MVV-LVA cho nước ăn quân, lịch sử cho nước thường.
void orderMoves(std::vector<ScoredMoveP>& moves, const PositionalSearchState& st);

// Khớp quiescenceGen (:1890-1923).
i32 quiescence(Board& b, Color color, i32 alpha, i32 beta, int depth, int ply,
                CsCode csRed, CsCode csBlack, PositionalSearchState& st);

// Khớp negamaxPositionalGen (:1946-1972).
i32 negamaxPositional(Board& b, Color color, int depth, i32 alpha, i32 beta, int ply,
                        CsCode csRed, CsCode csBlack, PositionalSearchState& st);

struct PositionalRootResult { bool hasMove = false; Move move; i32 score = 0; i32 rawScore = 0; };

// Khớp positionalRootGen (:1975-1994) — orderedMoves đã được bên gọi sinh + sắp thứ tự sẵn.
PositionalRootResult positionalRoot(Board& b, Color color, int depth, const std::vector<Move>& orderedMoves,
                                      CsCode csRed, CsCode csBlack, PositionalSearchState& st);

}  // namespace BruteForce

#endif  // BRUTEFORCE_POSITIONAL_H
