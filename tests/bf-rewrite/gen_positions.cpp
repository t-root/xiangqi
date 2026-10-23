// Sinh kho thế cờ ngẫu nhiên hợp lệ để đối chiếu bộ tìm mate của Brute-force.
// Mỗi thế đi ra từ khai cuộc chuẩn qua các nước ngẫu nhiên (ưu tiên ăn quân để ra tàn cuộc), dùng
// đúng bộ sinh nước của engine nên mọi thế đều hợp lệ về luật đi quân.
// Dựng: g++ -std=c++17 -O2 -I engine/bruteforce-src/src -o tests/binaries/gen_positions.exe \
//         tests/bf-rewrite/gen_positions.cpp engine/bruteforce-src/src/fen.cpp engine/bruteforce-src/src/movegen.cpp
// Chạy: gen_positions.exe <số thế> <seed> <quân tối đa> [quân tối thiểu]
#include "fen.h"
#include "movegen.h"
#include <cstdio>
#include <cstdlib>
#include <random>
#include <vector>

using namespace BruteForce;

static int countPieces(const Board& b) {
    int n = 0;
    for (const auto& row : b) for (const auto& p : row) if (!p.empty()) ++n;
    return n;
}

int main(int argc, char** argv) {
    const int count = argc > 1 ? std::atoi(argv[1]) : 100;
    const unsigned seed = argc > 2 ? static_cast<unsigned>(std::atoi(argv[2])) : 1u;
    const int maxPieces = argc > 3 ? std::atoi(argv[3]) : 12;
    const int minPieces = argc > 4 ? std::atoi(argv[4]) : 4;
    std::mt19937 rng(seed);
    const auto start = parseXiangqiFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w");
    int produced = 0, attempts = 0;
    while (produced < count && attempts < count * 200) {
        ++attempts;
        Board b = start->board;
        Color side = start->sideToMove;
        const int target = minPieces + static_cast<int>(rng() % static_cast<unsigned>(maxPieces - minPieces + 1));
        bool ok = true;
        for (int ply = 0; ply < 600 && countPieces(b) > target; ++ply) {
            std::vector<Move> legal;
            generateLegalMoves(b, side, legal);
            if (legal.empty()) { ok = false; break; }
            std::vector<Move> caps;
            for (const Move& m : legal) if (!b[m.to.row][m.to.col].empty()) caps.push_back(m);
            const bool takeCapture = !caps.empty() && (rng() % 100) < 70;
            const std::vector<Move>& pool = takeCapture ? caps : legal;
            const Move m = pool[rng() % pool.size()];
            makeMoveInPlace(b, m);
            side = otherColor(side);
        }
        if (!ok || countPieces(b) > target + 2) continue;
        Square k1, k2;
        if (!findKing(b, Color::Red, k1) || !findKing(b, Color::Black, k2)) continue;
        std::vector<Move> legal;
        generateLegalMoves(b, side, legal);
        if (legal.empty()) continue;
        std::printf("%s\n", boardToXiangqiFen(b, side).c_str());
        ++produced;
    }
    return produced == count ? 0 : 1;
}
