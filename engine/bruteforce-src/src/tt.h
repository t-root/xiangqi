#ifndef BRUTEFORCE_TT_H
#define BRUTEFORCE_TT_H

#include "types.h"
#include "hash.h"
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace BruteForce {

class TranspositionTable {
public:
    static constexpr size_t INITIAL_SLOTS = TT_SIZE;
    static constexpr uint64_t ENTRY_BYTES = sizeof(i32) * 4;

    TranspositionTable() { resizeSlots(INITIAL_SLOTS); }
    TranspositionTable(const TranspositionTable&) = delete;
    TranspositionTable& operator=(const TranspositionTable&) = delete;
    TranspositionTable(TranspositionTable&& other) noexcept { *this = std::move(other); }
    TranspositionTable& operator=(TranspositionTable&& other) noexcept {
        if (this == &other) return *this;
        segments_ = std::move(other.segments_);
        capacity_.store(other.capacity_.load(std::memory_order_relaxed), std::memory_order_relaxed);
        used_.store(other.used_.load(std::memory_order_relaxed), std::memory_order_relaxed);
        generation_ = other.generation_;
        other.capacity_.store(0, std::memory_order_relaxed);
        other.used_.store(0, std::memory_order_relaxed);
        other.generation_ = 1;
        return *this;
    }

    void resizeSlots(size_t slots) {
        if (!slots) throw std::invalid_argument("transposition table needs at least one slot");
        std::vector<Segment> fresh;
        fresh.emplace_back(slots);
        segments_ = std::move(fresh);
        capacity_.store(slots, std::memory_order_release);
        used_.store(0, std::memory_order_relaxed);
    }

    void growSlots(size_t additionalSlots) {
        if (!additionalSlots) return;
        if (additionalSlots > std::numeric_limits<size_t>::max() - capacitySlots())
            throw std::length_error("transposition table capacity overflow");
        segments_.emplace_back(additionalSlots);
        capacity_.fetch_add(additionalSlots, std::memory_order_release);
    }

    size_t capacitySlots() const { return capacity_.load(std::memory_order_acquire); }
    uint64_t capacityBytes() const { return static_cast<uint64_t>(capacitySlots()) * ENTRY_BYTES; }
    size_t used() const { return used_.load(std::memory_order_relaxed); }

    void clear() {
        ++generation_;
        if (generation_ > GENERATION_MAX) {
            for (Segment& segment : segments_) {
                std::fill_n(segment.meta.get(), segment.size, 0);
            }
            generation_ = 1;
        }
        used_.store(0, std::memory_order_relaxed);
    }

    struct Entry { i32 score; TTFlag flag; i32 code; };

    void store(i32 h1, i32 h2, int redBudget, int blackBudget, bool isRed,
               i32 score, TTFlag flag, i32 bestCode, int ply) {
        const uint32_t key = slotHash(h1, redBudget, blackBudget);
        const uint32_t segmentKey = slotHash(h2, redBudget, blackBudget);
        Segment& segment = segments_[segmentKey % segments_.size()];
        const size_t offset = key % segment.size;
        SlotData& slot = segment.slots[offset];
        i32 adjusted = score;
        if (adjusted > MATE_THRESHOLD) adjusted += ply;
        else if (adjusted < -MATE_THRESHOLD) adjusted -= ply;
        slot.verify = h2;
        slot.score = adjusted;
        slot.move = bestCode;
        const uint32_t previousMeta = segment.meta[offset];
        if ((previousMeta >> GENERATION_SHIFT) != generation_ || !(previousMeta & 1))
            used_.fetch_add(1, std::memory_order_relaxed);
        segment.meta[offset] = (generation_ << GENERATION_SHIFT) | 1 |
            (static_cast<uint32_t>(flag) << 1) | (static_cast<uint32_t>(redBudget) << 3) |
            (static_cast<uint32_t>(blackBudget) << 10) | (isRed ? (1u << 17) : 0);
    }

    bool lookup(i32 h1, i32 h2, int redBudget, int blackBudget, bool isRed,
                int ply, Entry& out) const {
        const uint32_t key = slotHash(h1, redBudget, blackBudget);
        for (auto segment = segments_.rbegin(); segment != segments_.rend(); ++segment) {
            const size_t offset = key % segment->size;
            const uint32_t meta = segment->meta[offset];
            if ((meta >> GENERATION_SHIFT) != generation_ || !(meta & 1) ||
                segment->slots[offset].verify != h2) continue;
            if (((meta >> 3) & 127) != redBudget || ((meta >> 10) & 127) != blackBudget) continue;
            if (((meta >> 17) & 1) != (isRed ? 1 : 0)) continue;
            const SlotData& slot = segment->slots[offset];
            i32 adjusted = slot.score;
            if (adjusted > MATE_THRESHOLD) adjusted -= ply;
            else if (adjusted < -MATE_THRESHOLD) adjusted += ply;
            out.score = adjusted;
            out.flag = static_cast<TTFlag>((meta >> 1) & 3);
            out.code = slot.move;
            return true;
        }
        return false;
    }

private:
    static constexpr uint32_t GENERATION_SHIFT = 18;
    static constexpr uint32_t GENERATION_MAX = (1u << (32 - GENERATION_SHIFT)) - 1;

    struct SlotData {
        i32 verify;
        i32 score;
        i32 move;
    };
    static_assert(sizeof(SlotData) == sizeof(i32) * 3);

    static std::unique_ptr<uint32_t[]> allocateZeroedMeta(size_t count) {
        auto* memory = static_cast<uint32_t*>(std::calloc(count, sizeof(uint32_t)));
        if (!memory) throw std::bad_alloc();
        return std::unique_ptr<uint32_t[]>(memory);
    }

    struct Segment {
        explicit Segment(size_t count)
            : size(count), slots(new SlotData[count]), meta(allocateZeroedMeta(count)) {}
        size_t size;
        std::unique_ptr<SlotData[]> slots;
        std::unique_ptr<uint32_t[]> meta;
    };

    static uint32_t slotHash(i32 hash, int redBudget, int blackBudget) {
        uint32_t value = static_cast<uint32_t>(hash) ^
            (static_cast<uint32_t>(redBudget + 1) * 0x9E3779B1u) ^
            (static_cast<uint32_t>(blackBudget + 1) * 0x85EBCA77u);
        value ^= value >> 15;
        value *= 0x2545F491u;
        value ^= value >> 13;
        return value;
    }

    std::vector<Segment> segments_;
    std::atomic<size_t> capacity_{0};
    std::atomic<size_t> used_{0};
    uint32_t generation_ = 1;
};

}  // namespace BruteForce

#endif  // BRUTEFORCE_TT_H
