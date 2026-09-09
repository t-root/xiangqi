#ifndef BRUTEFORCE_RULES_H
#define BRUTEFORCE_RULES_H

#include "types.h"
#include "movegen.h"
#include "hash.h"

namespace BruteForce {

// Luật chiếu liên tục — khớp csAdvanceAfterMove/nextCheckStreakAfterMove của app.
// Bên KHÔNG bị áp luật (xem csRestricted/CsSide) luôn trả về 0 — chiếu thoải mái, không giới hạn.
// Bên bị áp luật chỉ được CÙNG MỘT quân chiếu liên tiếp tối đa `limit` lần. Chế độ Phân Tích của
// app chỉ áp cho một bên (restrictedSide = Red/Black), chế độ Duyệt & Điều Khiển áp cả hai (Both,
// limit 3: nước chiếu lần 4 luôn thua, kể cả chiếu bí).
//
// Quân giữ chuỗi là quân ĐANG THẬT SỰ chiếu Tướng (collectCheckerSquares), không phải quân vừa đi:
// đi Mã chiếu mà mở hình cho Xe cũng chiếu thì CẢ HAI quân đều được một lượt, mỗi quân một bộ đếm.

// Trạng thái chuỗi chiếu MỚI của bên vừa đi, tính trên bàn `b` là thế cờ SAU nước đi.
// Trả 0 nếu nước này không chiếu (chuỗi đứt), -1 nếu phạm luật, ngược lại là trạng thái đã gói.
// Nhận diện "vẫn là quân cũ" bằng ô mà quân đó đứng TRƯỚC nước này: quân vừa đi thì đó là move.from,
// các quân khác thì chính ô chúng đang đứng (mỗi lượt bên mình chỉ đi được một quân).
inline CsCode csAdvanceAfterMove(const Board& b, CsCode code, const Move& move, Color color,
                                 Square oppKing, CsSide restrictedSide, int limit) {
    if (!csRestricted(restrictedSide, color)) return 0;
    Color opp = otherColor(color);
    if (!isKingAttacked(b, opp, oppKing)) return 0;

    int checkers[NUM_SQUARES];
    int cnt = collectCheckerSquares(b, opp, oppKing, checkers);
    int toSq = squareIndex(move.to), fromSq = squareIndex(move.from);
    // Số lần phải nhét vừa một chữ số hệ CS_COUNT_BASE — khớp chặn cùng chỗ bên app.
    int lim = limit < CS_COUNT_BASE - 1 ? limit : CS_COUNT_BASE - 1;
    CsCode next = 0, mult = 1;
    int slot = 0;
    for (int i = 0; i < cnt; ++i) {
        int sq = checkers[i];
        int n = csCountAt(code, sq == toSq ? fromSq : sq) + 1;
        if (n > lim) return -1;
        // Nhiều hơn CS_SLOTS quân cùng chiếu là chuyện không xảy ra trong cờ thật; nếu gặp thì bỏ
        // các quân ở ô lớn hơn, y như app bỏ, để hai bên vẫn ra cùng một số.
        if (slot >= CS_SLOTS) break;
        next += CsCode(sq * CS_COUNT_BASE + n) * mult;
        mult *= CS_DIGIT_BASE;
        ++slot;
    }
    return next;
}

struct CheckStreakResult {
    CsCode csRed, csBlack;
    bool brokeRule;
    i32 score;  // chỉ có ý nghĩa khi brokeRule=true
};

// hasAnyLegalMove — khớp :1538-1548: chỉ cần MỘT nước hợp lệ tồn tại, không cần liệt kê hết.
bool hasAnyLegalMove(const Board& b, Color color);

// Khớp nextCheckStreakAfterMove (:1928-1943): gọi SAU KHI đã đi move trên bàn b (b là thế cờ SAU
// nước đi). ply = độ sâu hiện tại (để tính điểm chiếu bí theo khoảng cách).
inline CheckStreakResult nextCheckStreakAfterMove(const Board& b, Color mover, const Move& move,
                                                    CsCode csRed, CsCode csBlack, int ply,
                                                    CsSide restrictedSide, int limit) {
    Color opp = otherColor(mover);
    Square oppKing;
    CsCode myOld = mover == Color::Red ? csRed : csBlack;
    CsCode ncs = findKing(b, opp, oppKing)
        ? csAdvanceAfterMove(b, myOld, move, mover, oppKing, restrictedSide, limit) : 0;
    if (ncs < 0) {
        // Chiếu quá số lần luôn thua — kể cả khi nước ấy đồng thời chiếu bí (thế cờ 50).
        i32 score = -(MATE_SCORE - (ply + 1));
        return {csRed, csBlack, true, score};
    }
    if (mover == Color::Red) return {ncs, csBlack, false, 0};
    return {csRed, ncs, false, 0};
}

}  // namespace BruteForce

#endif  // BRUTEFORCE_RULES_H
