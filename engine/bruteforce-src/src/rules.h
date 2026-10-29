#ifndef BRUTEFORCE_RULES_H
#define BRUTEFORCE_RULES_H

#include "types.h"
#include "movegen.h"
#include "hash.h"
#include <algorithm>

namespace BruteForce {

// Luật chiếu liên tục — khớp csAdvanceAfterMove/nextCheckStreakAfterMove của app.
// Bên KHÔNG bị áp luật (xem csRestricted/CsSide) luôn trả về 0 — chiếu thoải mái, không giới hạn.
// Bên bị áp luật chỉ được CÙNG MỘT quân chiếu liên tiếp tối đa `limit` lần. Chế độ Phân Tích của
// app chỉ áp cho một bên (restrictedSide = Red/Black), chế độ Duyệt & Điều Khiển áp cả hai (Both,
// limit 3: nước chiếu lần 4 luôn thua, kể cả chiếu bí).
//
// Quân giữ chuỗi là quân ĐANG THẬT SỰ chiếu Tướng (collectCheckerSquares), không phải quân vừa đi:
// đi Mã chiếu mà mở hình cho Xe cũng chiếu thì CẢ HAI quân đều được một lượt, mỗi quân một bộ đếm.

// Tách một digit đã gói thành (sq, n, bonus) — khớp csDecodeDigit() bên app.
// digit = (sq*CS_COUNT_BASE+n)*2+bonus.
struct CsDigit { int sq, n; bool bonus; };
inline CsDigit csDecodeDigit(CsCode digit) {
    int bonus = int(digit % 2);
    CsCode rest = (digit - bonus) / 2;
    int n = int(rest % CS_COUNT_BASE);
    int sq = int((rest - n) / CS_COUNT_BASE);
    return {sq, n, bonus != 0};
}
// Quân đứng ở ô `sq` đã DÙNG suất bonus "cản rồi bị ăn mà vẫn chiếu" chưa — khớp csBonusAt() bên
// app. false nếu ô đó không giữ chuỗi hoặc chưa dùng.
inline bool csBonusAt(CsCode code, int sq) {
    CsCode rest = code;
    while (rest > 0) {
        CsCode digit = rest % CS_DIGIT_BASE;
        rest = (rest - digit) / CS_DIGIT_BASE;
        if (digit > 0) { CsDigit d = csDecodeDigit(digit); if (d.sq == sq) return d.bonus; }
    }
    return false;
}
// fromSq, midSq, kingSq có thẳng hàng (cùng hàng hoặc cùng cột) và midSq nằm GIỮA hai đầu kia
// không — khớp squareBetweenOnLine() bên app. Dùng để nhận diện "vừa ăn đúng quân chắn trên
// đường chiếu cũ của chính mình".
inline bool squareBetweenOnLine(int fromSq, int midSq, int kingSq) {
    int fr = fromSq / BOARD_WIDTH, fc = fromSq % BOARD_WIDTH;
    int mr = midSq / BOARD_WIDTH, mc = midSq % BOARD_WIDTH;
    int kr = kingSq / BOARD_WIDTH, kc = kingSq % BOARD_WIDTH;
    if (fr == mr && mr == kr) return mc > std::min(fc, kc) && mc < std::max(fc, kc);
    if (fc == mc && mc == kc) return mr > std::min(fr, kr) && mr < std::max(fr, kr);
    return false;
}

// Trạng thái chuỗi chiếu MỚI của bên vừa đi, tính trên bàn `b` là thế cờ SAU nước đi.
// Trả 0 nếu nước này không chiếu (chuỗi đứt), -1 nếu phạm luật, ngược lại là trạng thái đã gói.
// Nhận diện "vẫn là quân cũ" bằng ô mà quân đó đứng TRƯỚC nước này: quân vừa đi thì đó là move.from,
// các quân khác thì chính ô chúng đang đứng (mỗi lượt bên mình chỉ đi được một quân).
//
// bonusRuleOn/isCapture: luật mở rộng TUỲ CHỌN "cản rồi bị ăn mà vẫn chiếu" — khớp
// checkStreakBonusRuleOn bên app. CHỈ áp dụng khi quân chắn bị ăn là quân đã cản đúng LẦN CHIẾU
// ĐẦU TIÊN của chuỗi (prevN đúng bằng 1, tức fromSq mới chỉ chiếu 1 lần trước nước này) — nếu quân
// chắn xuất hiện ở lần chiếu thứ 2 trở đi thì ăn nó KHÔNG được cấp thêm suất (đã xác nhận với
// người dùng: chỉ lần chắn-ăn ở chiếu lần 1 mới hợp lệ, lần chắn-ăn ở chiếu lần 2+ là không hợp
// lệ dù vẫn tiếp tục chiếu). Khi hợp lệ, quân đó được +1 suất chiếu cho hết chuỗi (đúng 1 lần,
// không cộng dồn).
inline CsCode csAdvanceAfterMove(const Board& b, CsCode code, const Move& move, Color color,
                                 Square oppKing, CsSide restrictedSide, int limit,
                                 bool bonusRuleOn = false, bool isCapture = false) {
    if (!csRestricted(restrictedSide, color)) return 0;
    Color opp = otherColor(color);
    if (!isKingAttacked(b, opp, oppKing)) return 0;

    int checkers[NUM_SQUARES];
    int cnt = collectCheckerSquares(b, opp, oppKing, checkers);
    int toSq = squareIndex(move.to), fromSq = squareIndex(move.from);
    int kingSq = squareIndex(oppKing);
    // Số lần phải nhét vừa một chữ số hệ CS_COUNT_BASE — khớp chặn cùng chỗ bên app.
    int lim = limit < CS_COUNT_BASE - 1 ? limit : CS_COUNT_BASE - 1;
    CsCode next = 0, mult = 1;
    int slot = 0;
    for (int i = 0; i < cnt; ++i) {
        int sq = checkers[i];
        int identSq = sq == toSq ? fromSq : sq;
        int prevN = csCountAt(code, identSq);
        int n = prevN + 1;
        bool bonus = csBonusAt(code, identSq);
        if (!bonus && bonusRuleOn && sq == toSq && prevN == 1 && isCapture
            && squareBetweenOnLine(fromSq, toSq, kingSq)) {
            bonus = true;
        }
        if (n > lim + (bonus ? 1 : 0)) return -1;
        // Nhiều hơn CS_SLOTS quân cùng chiếu là chuyện không xảy ra trong cờ thật; nếu gặp thì bỏ
        // các quân ở ô lớn hơn, y như app bỏ, để hai bên vẫn ra cùng một số.
        if (slot >= CS_SLOTS) break;
        next += CsCode((sq * CS_COUNT_BASE + n) * 2 + (bonus ? 1 : 0)) * mult;
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
// nước đi). ply = độ sâu hiện tại (để tính điểm chiếu bí theo khoảng cách). bonusRuleOn/isCapture
// forward thẳng xuống csAdvanceAfterMove — xem ghi chú ở đó.
inline CheckStreakResult nextCheckStreakAfterMove(const Board& b, Color mover, const Move& move,
                                                    CsCode csRed, CsCode csBlack, int ply,
                                                    CsSide restrictedSide, int limit,
                                                    bool bonusRuleOn = false, bool isCapture = false) {
    Color opp = otherColor(mover);
    Square oppKing;
    CsCode myOld = mover == Color::Red ? csRed : csBlack;
    CsCode ncs = findKing(b, opp, oppKing)
        ? csAdvanceAfterMove(b, myOld, move, mover, oppKing, restrictedSide, limit, bonusRuleOn, isCapture) : 0;
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
