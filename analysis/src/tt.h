#ifndef BRUTEFORCE_TT_H
#define BRUTEFORCE_TT_H

#include "types.h"
#include "hash.h"
#include <vector>
#include <cstdint>
#include <istream>
#include <ostream>
#include <algorithm>

namespace BruteForce {

// Bảng băm — khớp ttSlot/ttStore/ttLookup (xiangqi-analyzer.html:1596-1623).
// Mỗi luồng tìm kiếm (native thread) giữ một TranspositionTable RIÊNG, khớp đúng hành vi bản JS
// (mỗi Worker có TT độc lập, không chia sẻ — xem báo cáo khảo sát §8: "Workers do NOT share a TT").
//
// [testphantich] Khác bản gốc: kích thước đặt được lúc chạy (HashBits, 2^bits ô, mỗi ô 16 byte) và có thể
// ghi/đọc ra đĩa (writeTo/readFrom, chỉ ghi các ô đang dùng) để lưu tiến độ giữa các lần chạy.
class TranspositionTable {
public:
    static constexpr int MIN_BITS = 16;
    static constexpr int MAX_BITS = 26;

    TranspositionTable() { resize(TT_BITS); }

    // Đổi kích thước (xoá sạch). bits ngoài [MIN_BITS, MAX_BITS] bị kẹp.
    void resize(int bits) {
        bits_ = std::max(MIN_BITS, std::min(MAX_BITS, bits));
        const size_t size = size_t(1) << bits_;
        mask_ = static_cast<uint32_t>(size - 1);
        verify_.assign(size, 0);
        score_.assign(size, 0);
        meta_.assign(size, 0);
        move_.assign(size, 0);
    }
    int bits() const { return bits_; }

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

    // Số ô đang dùng.
    size_t used() const {
        size_t n = 0;
        for (i32 m : meta_) n += (m & 1);
        return n;
    }

    // Ghi thưa: [bits u32][count u32] rồi mỗi ô dùng là (index, verify, score, meta, move) — 5 x i32.
    void writeTo(std::ostream& os) const {
        const uint32_t bits = static_cast<uint32_t>(bits_);
        const uint32_t count = static_cast<uint32_t>(used());
        os.write(reinterpret_cast<const char*>(&bits), sizeof bits);
        os.write(reinterpret_cast<const char*>(&count), sizeof count);
        for (size_t i = 0; i < meta_.size(); ++i) {
            if (!(meta_[i] & 1)) continue;
            const i32 rec[5] = {static_cast<i32>(i), verify_[i], score_[i], meta_[i], move_[i]};
            os.write(reinterpret_cast<const char*>(rec), sizeof rec);
        }
    }

    // Đọc lại. Trả false nếu dữ liệu hỏng hoặc kích thước bảng khác (không ghi đè gì khi thất bại).
    bool readFrom(std::istream& is) {
        uint32_t bits = 0, count = 0;
        is.read(reinterpret_cast<char*>(&bits), sizeof bits);
        is.read(reinterpret_cast<char*>(&count), sizeof count);
        if (!is || static_cast<int>(bits) < MIN_BITS || static_cast<int>(bits) > MAX_BITS) return false;
        if (static_cast<int>(bits) != bits_) resize(static_cast<int>(bits));   // theo kích thước đã lưu
        if (count > meta_.size()) return false;
        std::vector<i32> recs(static_cast<size_t>(count) * 5);
        if (count) is.read(reinterpret_cast<char*>(recs.data()), static_cast<std::streamsize>(recs.size() * sizeof(i32)));
        if (!is) return false;
        for (uint32_t k = 0; k < count; ++k) {
            const i32* r = &recs[static_cast<size_t>(k) * 5];
            if (r[0] < 0 || static_cast<size_t>(r[0]) >= meta_.size() || !(r[3] & 1)) return false;
        }
        clear();
        for (uint32_t k = 0; k < count; ++k) {
            const i32* r = &recs[static_cast<size_t>(k) * 5];
            const size_t i = static_cast<size_t>(r[0]);
            verify_[i] = r[1]; score_[i] = r[2]; meta_[i] = r[3]; move_[i] = r[4];
        }
        return true;
    }

private:
    int slot(i32 h1, int redBudget, int blackBudget) const {
        uint32_t x = static_cast<uint32_t>(h1) ^ (static_cast<uint32_t>(redBudget + 1) * 0x9E3779B1u)
                                                ^ (static_cast<uint32_t>(blackBudget + 1) * 0x85EBCA77u);
        x ^= x >> 15; x *= 0x2545F491u; x ^= x >> 13;
        return static_cast<int>(x & mask_);
    }

    int bits_ = TT_BITS;
    uint32_t mask_ = 0;
    std::vector<i32> verify_, score_, meta_, move_;
};

}  // namespace BruteForce

#endif  // BRUTEFORCE_TT_H
