#include "../analysis/src/fen.h"
#include "../analysis/src/search.h"
#include <iostream>
#include <sstream>

using namespace BruteForce;

int main() {
    TranspositionTable table;
    table.resizeSlots(17);
    table.store(12345, 67890, 4, 3, true, MATE_SCORE - 7, TTFlag::Exact, 42, 3);

    table.growSlots(19);
    TranspositionTable::Entry hit{};
    if (!table.lookup(12345, 67890, 4, 3, true, 5, hit) ||
        hit.score != MATE_SCORE - 9 || hit.flag != TTFlag::Exact || hit.code != 42) {
        std::cerr << "entry was not preserved across hash growth\n";
        return 1;
    }

    table.store(-123, 456, 2, 1, false, -37, TTFlag::Lower, 19, 0);
    std::stringstream checkpoint(std::ios::in | std::ios::out | std::ios::binary);
    table.writeTo(checkpoint);

    TranspositionTable restored;
    restored.resizeSlots(17);
    restored.growSlots(19);
    checkpoint.seekg(0);
    if (!restored.readFrom(checkpoint)) {
        std::cerr << "grown hash checkpoint could not be read\n";
        return 1;
    }
    if (!restored.lookup(12345, 67890, 4, 3, true, 5, hit) ||
        hit.score != MATE_SCORE - 9 || hit.code != 42 ||
        !restored.lookup(-123, 456, 2, 1, false, 0, hit) ||
        hit.score != -37 || hit.flag != TTFlag::Lower || hit.code != 19) {
        std::cerr << "grown hash checkpoint did not preserve entries\n";
        return 1;
    }

    restored.clear();
    if (restored.lookup(12345, 67890, 4, 3, true, 5, hit)) {
        std::cerr << "clear retained a transposition entry\n";
        return 1;
    }

    TranspositionTable distribution;
    distribution.resizeSlots(1024);
    distribution.growSlots(1024);
    for (i32 key = 0; key < 10000; ++key) {
        const i32 secondHash = key * 7919 + 104729;
        distribution.store(key, secondHash, 4, 3, true, key, TTFlag::Exact, key, 0);
    }
    if (distribution.used() * 100 < distribution.capacitySlots() * 85) {
        std::cerr << "grown table occupancy stalled below 85%: "
                  << distribution.used() << '/' << distribution.capacitySlots() << '\n';
        return 1;
    }

    const auto position = parseXiangqiFen("9/3k5/9/9/9/9/9/4KC3/7c1/8C w - - 0 1");
    if (!position) {
        std::cerr << "could not parse growth-trigger test position\n";
        return 1;
    }
    MateSearchState search;
    search.tt.resizeSlots(16);
    for (i32 key = 0; search.tt.used() < 16 && key < 1000; ++key)
        search.tt.store(key, key ^ 0x5A5A, 60, 60, true, 0, TTFlag::Exact, 0, 0);
    if (search.tt.used() != 16) {
        std::cerr << "could not prepare a full table for the growth-trigger test\n";
        return 1;
    }
    int growthCalls = 0;
    search.growHashTable = [&growthCalls](TranspositionTable& table) {
        if (++growthCalls > 1) return false;
        table.growSlots(8);
        return true;
    };
    Board board = position->board;
    const HashPair hash = hashBoardPair(board);
    negamaxForcedMateGen(board, position->sideToMove, 3, 3, 0, -SEARCH_INF, SEARCH_INF,
                         hash.h1, hash.h2, 0, 0, search);
    if (growthCalls != 1 || search.tt.capacitySlots() != 24) {
        std::cerr << "search growth trigger mismatch: calls=" << growthCalls
                  << " capacity=" << search.tt.capacitySlots() << '\n';
        return 1;
    }
    return 0;
}
