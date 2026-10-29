#include "fen.h"
#include "search.h"

#include <iostream>
#include <vector>

using namespace BruteForce;

namespace {

bool matchesBoardScan(const Board& board, Color color, const PieceSquareSet& pieces) {
    std::vector<Move> scanned;
    std::vector<Move> indexed;
    generatePseudoMoveList(board, color, scanned);
    generatePseudoMoveList(board, color, pieces, indexed);
    return scanned == indexed;
}

}  // namespace

int main() {
    TranspositionTable table;
    table.resizeSlots(17);
    table.store(12345, 67890, 4, 3, true, MATE_SCORE - 7, TTFlag::Exact, 42, 3);
    table.growSlots(19);
    TranspositionTable::Entry entry{};
    if (!table.lookup(12345, 67890, 4, 3, true, 5, entry) ||
        entry.score != MATE_SCORE - 9 || entry.flag != TTFlag::Exact || entry.code != 42) {
        std::cerr << "FAIL compact transposition entry changed across table growth\n";
        return 1;
    }
    table.clear();
    if (table.lookup(12345, 67890, 4, 3, true, 5, entry)) {
        std::cerr << "FAIL cleared transposition entry remained readable\n";
        return 1;
    }

    const auto initial = parseXiangqiFen(
        "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    if (!initial) {
        std::cerr << "FAIL could not parse initial position\n";
        return 1;
    }

    Board board = initial->board;
    Color side = initial->sideToMove;
    PieceSquareSet pieces;
    pieces.reset(board);
    uint32_t random = 0x9E3779B9u;

    for (int ply = 0; ply < 240; ++ply) {
        const bool redMovesMatch = matchesBoardScan(board, Color::Red, pieces);
        const bool blackMovesMatch = matchesBoardScan(board, Color::Black, pieces);
        if (!redMovesMatch || !blackMovesMatch) {
            std::cerr << "FAIL indexed move generation differs at ply " << ply << '\n';
            std::cerr << "redMoves=" << redMovesMatch << " blackMoves=" << blackMovesMatch << '\n';
            return 1;
        }

        std::vector<Move> legal;
        generateLegalMoves(board, side, legal);
        if (legal.empty()) {
            board = initial->board;
            side = initial->sideToMove;
            pieces.reset(board);
            continue;
        }

        for (const Move& move : legal) {
            const Piece captured = makeMoveInPlace(board, move);
            pieces.apply(move, side, captured);
            if (!matchesBoardScan(board, otherColor(side), pieces)) {
                std::cerr << "FAIL indexed move generation differs after move at ply " << ply << '\n';
                return 1;
            }
            undoMoveInPlace(board, move, captured);
            pieces.undo(move, side, captured);
            if (!matchesBoardScan(board, Color::Red, pieces) ||
                !matchesBoardScan(board, Color::Black, pieces)) {
                std::cerr << "FAIL piece index did not restore after move at ply " << ply << '\n';
                return 1;
            }
        }

        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        const Move move = legal[random % legal.size()];
        const Piece captured = makeMoveInPlace(board, move);
        pieces.apply(move, side, captured);
        side = otherColor(side);
    }

    std::cout << "PASS piece-square move generation matches board scan through 240 plies\n";
    return 0;
}
