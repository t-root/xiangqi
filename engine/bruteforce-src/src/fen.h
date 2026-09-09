#ifndef BRUTEFORCE_FEN_H
#define BRUTEFORCE_FEN_H

#include "types.h"
#include <string>
#include <optional>

namespace BruteForce {

struct ParsedPosition { Board board; Color sideToMove; };

// Khớp boardToXiangqiFen (xiangqi-analyzer.html:5572-5588) và chiều ngược lại — dùng CHUNG định
// dạng FEN với Pikafish (hàng đầu = hàng cuối Đen, 'w'=Đỏ đi, 'b'=Đen đi) nên app không cần đổi
// gì khi chuyển engine.
std::optional<ParsedPosition> parseXiangqiFen(const std::string& fen);
std::string boardToXiangqiFen(const Board& b, Color colorToMove);

// Khớp parseUciSquare/parseUciMove (:5594-5602): "h2e2" kiểu ký hiệu UCI của Pikafish.
Square parseUciSquare(const std::string& s);

// Đọc giá trị option "CheckStreak_RootRed"/"CheckStreak_RootBlack": danh sách "ô:số_lần" cách nhau
// bằng dấu phẩy ("e5:2,c3:1"), "none" (hoặc bất cứ gì không đọc được) thành 0. Trả về đúng số gói
// mà csAdvanceAfterMove hiểu — khớp csEncodeForProtocol của app, đọc theo chiều ngược lại.
CsCode parseCheckStreakRootOption(const std::string& value);
std::string squareToUci(Square s);
std::string moveToUci(const Move& m);
std::optional<Move> parseUciMove(const std::string& s);

}  // namespace BruteForce

#endif  // BRUTEFORCE_FEN_H
