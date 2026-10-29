#ifndef BRUTEFORCE_REPETITION_H
#define BRUTEFORCE_REPETITION_H

#include "types.h"
#include "hash.h"
#include <vector>

namespace BruteForce {

// Khoá lặp thế — dùng cặp băm Zobrist (h1,h2) + bên tới lượt thay cho chuỗi ký tự bàn cờ như bản
// JS (boardKey+repetitionKey, :1762-1776): cùng ý nghĩa "cùng hình cờ + cùng bên đi = cùng khoá",
// chỉ đổi cách biểu diễn để hợp với C++, không đổi Ngữ nghĩa/kết quả so sánh lặp thế.
struct RepetitionEntry {
    i32 h1, h2;
    Color sideToMove;
    Color mover;      // bên VỪA đi để tạo ra thế cờ này (Color::None cho thế cờ xuất phát)
    bool gaveCheck;    // mover có đang chiếu sideToMove hay không (dùng phân xử "chiếu mãi")

    bool sameKey(const RepetitionEntry& o) const {
        return h1 == o.h1 && h2 == o.h2 && sideToMove == o.sideToMove;
    }
};

// Khớp positionHistory (mảng sống theo ván đang chơi — RỖNG khi đang ở chế độ Phân Tích thuần từ
// bàn tĩnh, khớp ghi chú :1818 "Chỉ có tác dụng khi đang chơi").
class PositionHistory {
public:
    void clear() { entries_.clear(); }  // gọi khi có nước ăn quân (:2483) hoặc bắt đầu ván mới
    bool empty() const { return entries_.empty(); }
    size_t size() const { return entries_.size(); }
    void push(RepetitionEntry e) { entries_.push_back(e); }
    const RepetitionEntry& back() const { return entries_.back(); }
    const RepetitionEntry& at(size_t i) const { return entries_[i]; }

    int countMatches(const RepetitionEntry& key) const {  // khớp countRepetitions (:1809-1813)
        int n = 0;
        for (const auto& e : entries_) if (e.sameKey(key)) ++n;
        return n;
    }

private:
    std::vector<RepetitionEntry> entries_;
};

// Khớp repetitionPenalty (:1819-1825) — phạt điểm MỀM dùng trong tìm kiếm thế trận, KHÔNG phải
// phán xử cứng. positionHistory rỗng (đang Phân Tích) ⇒ luôn 0.
inline i32 repetitionPenalty(const PositionHistory& history, const RepetitionEntry& afterMoveKey) {
    if (history.empty()) return 0;
    int count = history.countMatches(afterMoveKey);
    if (count >= REPETITION_LIMIT - 1) return MATE_SCORE - 1;
    if (count == 1) return REPETITION_PENALTY;
    return 0;
}

struct RepetitionVerdict {
    bool triggered = false;
    Color loser = Color::None;
    const char* reason = "";  // "perpetual-check" hoặc "repetition", khớp :1849/:1853
};

// Khớp adjudicateRepetition (:1827-1859) — phán xử CỨNG, gọi sau mỗi nước đi thật trong ván đang
// chơi. Chỉ xét đúng CHU KỲ LẶP GẦN NHẤT (từ lần xuất hiện liền trước tới bây giờ), có ngoại lệ
// "chiếu mãi" ưu tiên trước quy tắc mặc định "ai khép vòng lặp thứ 3 thì thua".
RepetitionVerdict adjudicateRepetition(const PositionHistory& history);

}  // namespace BruteForce

#endif  // BRUTEFORCE_REPETITION_H
