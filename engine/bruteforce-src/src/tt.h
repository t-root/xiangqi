#ifndef BRUTEFORCE_TT_H
#define BRUTEFORCE_TT_H

#include "types.h"
#include "hash.h"
#include <vector>
#include <cstdint>

namespace BruteForce {

// Bảng băm — khớp ttSlot/ttStore/ttLookup (xiangqi-analyzer.html:1596-1623).
// Mỗi luồng tìm kiếm (native thread) giữ một TranspositionTable RIÊNG, khớp đúng hành vi bản JS
// (mỗi Worker có TT độc lập, không chia sẻ — xem báo cáo khảo sát §8: "Workers do NOT share a TT").
class TranspositionTable {
public:
    TranspositionTable() : verify_(TT_SIZE, 0), score_(TT_SIZE, 0), meta_(TT_SIZE, 0), move_(TT_SIZE, 0) {}

    void clear() {
        std::fill(meta_.begin(), meta_.end(), 0);
        std::fill(move_.begin(), move_.end(), 0);
        // verify_/score_ không cần xoá — vô nghĩa nếu bit "hợp lệ" trong meta bằng 0 (khớp
        // resetSearchTables() :1578-1582, vốn cũng chỉ fill(0) ttMetaArr/ttMoveArr).
    }

    struct Entry { i32 score; TTFlag flag; i32 code; };

    void store(i32 h1, i32 h2, int redBudget, int blackBudget, bool isRed, i32 score, TTFlag flag, i32 bestCode, int ply) {
        int i = slot(h1, redBudget, blackBudget);
        i32 s = score;
        if (s > MATE_THRESHOLD) s += ply; else if (s < -MATE_THRESHOLD) s -= ply;
        verify_[i] = h2;
        score_[i] = s;
        move_[i] = bestCode;
        meta_[i] = 1 | (static_cast<i32>(flag) << 1) | (redBudget << 3) | (blackBudget << 10) | (isRed ? (1 << 17) : 0);
    }

    bool lookup(i32 h1, i32 h2, int redBudget, int blackBudget, bool isRed, int ply, Entry& out) const {
        int i = slot(h1, redBudget, blackBudget);
        i32 meta = meta_[i];
        if (!(meta & 1) || verify_[i] != h2) return false;
        if (((meta >> 3) & 127) != redBudget || ((meta >> 10) & 127) != blackBudget) return false;
        if (((meta >> 17) & 1) != (isRed ? 1 : 0)) return false;
        i32 s = score_[i];
        if (s > MATE_THRESHOLD) s -= ply; else if (s < -MATE_THRESHOLD) s += ply;
        out.score = s;
        out.flag = static_cast<TTFlag>((meta >> 1) & 3);
        out.code = move_[i];
        return true;
    }

private:
    static int slot(i32 h1, int redBudget, int blackBudget) {
        uint32_t x = static_cast<uint32_t>(h1) ^ (static_cast<uint32_t>(redBudget + 1) * 0x9E3779B1u)
                                                ^ (static_cast<uint32_t>(blackBudget + 1) * 0x85EBCA77u);
        x ^= x >> 15; x *= 0x2545F491u; x ^= x >> 13;
        return static_cast<int>(x & TT_MASK);
    }

    std::vector<i32> verify_, score_, meta_, move_;
};

}  // namespace BruteForce

#endif  // BRUTEFORCE_TT_H
