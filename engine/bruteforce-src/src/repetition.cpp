// Cổng chính xác adjudicateRepetition (xiangqi-analyzer.html:1827-1859).

#include "repetition.h"

namespace BruteForce {

RepetitionVerdict adjudicateRepetition(const PositionHistory& history) {
    RepetitionVerdict v;
    if (history.empty()) return v;

    const RepetitionEntry& last = history.back();
    std::vector<size_t> hits;
    for (size_t i = 0; i < history.size(); ++i)
        if (history.at(i).sameKey(last)) hits.push_back(i);

    if (static_cast<int>(hits.size()) < REPETITION_LIMIT) return v;  // khớp :1833

    // Chỉ xét đúng chu kỳ lặp gần nhất — khớp :1838-1842.
    size_t cycleStart = hits[hits.size() - 2];

    int moved[2] = {0, 0}, checked[2] = {0, 0};
    for (size_t i = cycleStart + 1; i < history.size(); ++i) {
        const RepetitionEntry& e = history.at(i);
        if (e.mover == Color::None) continue;
        int idx = e.mover == Color::Red ? 0 : 1;
        ++moved[idx];
        if (e.gaveCheck) ++checked[idx];
    }
    auto perpetual = [&](int idx) { return moved[idx] > 0 && checked[idx] == moved[idx]; };
    bool redPerp = perpetual(0), blackPerp = perpetual(1);

    if (redPerp && !blackPerp) { v.triggered = true; v.loser = Color::Red; v.reason = "perpetual-check"; return v; }
    if (blackPerp && !redPerp) { v.triggered = true; v.loser = Color::Black; v.reason = "perpetual-check"; return v; }

    // Còn lại: ai đi nước khép vòng lặp lần thứ 3 thì người đó thua — khớp :1852-1853.
    v.triggered = true;
    v.loser = last.mover;
    v.reason = "repetition";
    return v;
}

}  // namespace BruteForce
