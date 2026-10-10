// Cổng chính xác từ getPseudoMoves/isKingAttacked/findKing/kingsFacing/generateLegalMoves
// (xiangqi-analyzer.html:1230-1458). Giữ nguyên từng nhánh, kể cả các "quirk" cụ thể của cách
// JS viết (không phải luật sách giáo khoa tổng quát) để đảm bảo khớp bit-by-bit.

#include "movegen.h"

#include <algorithm>

namespace BruteForce {

bool findKing(const Board& b, Color color, Square& out) {
    int r0 = color == Color::Red ? 7 : 0;
    int r1 = color == Color::Red ? 9 : 2;
    for (int r = r0; r <= r1; ++r)
        for (int c = 3; c <= 5; ++c)
            if (b[r][c].type == PieceType::King && b[r][c].color == color) { out = {r, c}; return true; }
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c)
            if (b[r][c].type == PieceType::King && b[r][c].color == color) { out = {r, c}; return true; }
    return false;
}

bool kingsFacing(const Board& b) {
    Square red, black;
    if (!findKing(b, Color::Red, red) || !findKing(b, Color::Black, black)) return false;
    if (red.col != black.col) return false;
    int top = std::min(red.row, black.row), bottom = std::max(red.row, black.row);
    for (int r = top + 1; r < bottom; ++r)
        if (!b[r][red.col].empty()) return false;
    return true;
}

namespace {
constexpr int ORTHO_DIRS[4][2] = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
struct HorseAttack { int sr, sc, lr, lc; };
constexpr HorseAttack HORSE_ATTACK_OFFSETS[8] = {
    {2, 1, 1, 1}, {2, -1, 1, -1}, {-2, 1, -1, 1}, {-2, -1, -1, -1},
    {1, 2, 1, 1}, {-1, 2, -1, 1}, {1, -2, 1, -1}, {-1, -2, -1, -1},
};
}  // namespace

bool isKingAttacked(const Board& b, Color color, Square king) {
    int kr = king.row, kc = king.col;
    Color opp = otherColor(color);

    for (auto& d : ORTHO_DIRS) {
        int r = kr + d[0], c = kc + d[1], count = 0;
        while (inBounds(r, c)) {
            const Piece& p = b[r][c];
            if (!p.empty()) {
                ++count;
                if (count == 1) {
                    if (p.color == opp && (p.type == PieceType::Chariot || p.type == PieceType::King)) return true;
                } else {
                    if (p.color == opp && p.type == PieceType::Cannon) return true;
                    break;
                }
            }
            r += d[0]; c += d[1];
        }
    }

    for (auto& h : HORSE_ATTACK_OFFSETS) {
        int sr = kr + h.sr, sc = kc + h.sc;
        if (inBounds(sr, sc)) {
            const Piece& p = b[sr][sc];
            if (!p.empty() && p.color == opp && p.type == PieceType::Horse) {
                int lr = kr + h.lr, lc = kc + h.lc;
                if (b[lr][lc].empty()) return true;
            }
        }
    }

    // Tốt/Binh: khớp :1393-1403 — ăn ngang chỉ sau khi qua sông (kr>=5 cho Đỏ bị chiếu, kr<=4 cho Đen bị chiếu).
    if (color == Color::Red) {
        if (inBounds(kr - 1, kc) && b[kr - 1][kc].color == Color::Black && b[kr - 1][kc].type == PieceType::Soldier) return true;
        for (int dc : {-1, 1}) {
            if (inBounds(kr, kc + dc) && b[kr][kc + dc].color == Color::Black && b[kr][kc + dc].type == PieceType::Soldier && kr >= 5) return true;
        }
    } else {
        if (inBounds(kr + 1, kc) && b[kr + 1][kc].color == Color::Red && b[kr + 1][kc].type == PieceType::Soldier) return true;
        for (int dc : {-1, 1}) {
            if (inBounds(kr, kc + dc) && b[kr][kc + dc].color == Color::Red && b[kr][kc + dc].type == PieceType::Soldier && kr <= 4) return true;
        }
    }
    return false;
}

// Bản "thu hết" của isKingAttacked ở trên — khớp collectCheckerSquares() của app từng nhánh một.
// Giữ nguyên thứ tự quét (dọc/ngang, Mã, Tốt) rồi sắp tăng dần ở cuối, y như bản JS.
int collectCheckerSquares(const Board& b, Color color, Square king, int* out) {
    int kr = king.row, kc = king.col;
    Color opp = otherColor(color);
    int n = 0;

    for (auto& d : ORTHO_DIRS) {
        int r = kr + d[0], c = kc + d[1], count = 0;
        while (inBounds(r, c)) {
            const Piece& p = b[r][c];
            if (!p.empty()) {
                ++count;
                if (count == 1) {
                    if (p.color == opp && (p.type == PieceType::Chariot || p.type == PieceType::King)) out[n++] = squareIndex(r, c);
                } else {
                    if (p.color == opp && p.type == PieceType::Cannon) out[n++] = squareIndex(r, c);
                    break;
                }
            }
            r += d[0]; c += d[1];
        }
    }

    for (auto& h : HORSE_ATTACK_OFFSETS) {
        int sr = kr + h.sr, sc = kc + h.sc;
        if (inBounds(sr, sc)) {
            const Piece& p = b[sr][sc];
            if (!p.empty() && p.color == opp && p.type == PieceType::Horse) {
                int lr = kr + h.lr, lc = kc + h.lc;
                if (b[lr][lc].empty()) out[n++] = squareIndex(sr, sc);
            }
        }
    }

    if (color == Color::Red) {
        if (inBounds(kr - 1, kc) && b[kr - 1][kc].color == Color::Black && b[kr - 1][kc].type == PieceType::Soldier) out[n++] = squareIndex(kr - 1, kc);
        for (int dc : {-1, 1}) {
            if (inBounds(kr, kc + dc) && b[kr][kc + dc].color == Color::Black && b[kr][kc + dc].type == PieceType::Soldier && kr >= 5) out[n++] = squareIndex(kr, kc + dc);
        }
    } else {
        if (inBounds(kr + 1, kc) && b[kr + 1][kc].color == Color::Red && b[kr + 1][kc].type == PieceType::Soldier) out[n++] = squareIndex(kr + 1, kc);
        for (int dc : {-1, 1}) {
            if (inBounds(kr, kc + dc) && b[kr][kc + dc].color == Color::Red && b[kr][kc + dc].type == PieceType::Soldier && kr <= 4) out[n++] = squareIndex(kr, kc + dc);
        }
    }

    std::sort(out, out + n);
    return n;
}

void getPseudoMoves(const Board& b, int row, int col, std::vector<Move>& out) {
    const Piece& piece = b[row][col];
    PieceType type = piece.type;
    Color color = piece.color;

    auto push = [&](int r, int c) {
        if (!inBounds(r, c)) return;
        const Piece& t = b[r][c];
        if (t.empty() || t.color != color) out.push_back({{row, col}, {r, c}});
    };

    if (type == PieceType::Soldier) {
        int fwd = color == Color::Red ? -1 : 1;
        push(row + fwd, col);
        bool crossed = color == Color::Red ? row <= 4 : row >= 5;
        if (crossed) { push(row, col - 1); push(row, col + 1); }
    } else if (type == PieceType::Horse) {
        struct Jump { int dr, dc, lr, lc; };
        static constexpr Jump jumps[8] = {
            {-2, -1, -1, 0}, {-2, 1, -1, 0}, {2, -1, 1, 0}, {2, 1, 1, 0},
            {-1, -2, 0, -1}, {1, -2, 0, -1}, {-1, 2, 0, 1}, {1, 2, 0, 1},
        };
        for (auto& j : jumps) {
            int legR = row + j.lr, legC = col + j.lc;
            if (!inBounds(legR, legC) || !b[legR][legC].empty()) continue;
            push(row + j.dr, col + j.dc);
        }
    } else if (type == PieceType::Elephant) {
        static constexpr int diag[4][2] = {{-2, -2}, {-2, 2}, {2, -2}, {2, 2}};
        for (auto& d : diag) {
            int tr = row + d[0], tc = col + d[1];
            int er = row + d[0] / 2, ec = col + d[1] / 2;
            if (!inBounds(tr, tc) || !b[er][ec].empty()) continue;
            if (color == Color::Red ? tr < 5 : tr > 4) continue;
            push(tr, tc);
        }
    } else if (type == PieceType::Advisor) {
        static constexpr int diag[4][2] = {{-1, -1}, {-1, 1}, {1, -1}, {1, 1}};
        for (auto& d : diag) {
            int tr = row + d[0], tc = col + d[1];
            if (inPalace(tr, tc, color)) push(tr, tc);
        }
    } else if (type == PieceType::King) {
        for (auto& d : ORTHO_DIRS) {
            int tr = row + d[0], tc = col + d[1];
            if (inPalace(tr, tc, color)) push(tr, tc);
        }
    } else if (type == PieceType::Chariot) {
        for (auto& d : ORTHO_DIRS) {
            int tr = row + d[0], tc = col + d[1];
            while (inBounds(tr, tc)) {
                const Piece& t = b[tr][tc];
                if (t.empty()) { out.push_back({{row, col}, {tr, tc}}); }
                else { if (t.color != color) out.push_back({{row, col}, {tr, tc}}); break; }
                tr += d[0]; tc += d[1];
            }
        }
    } else if (type == PieceType::Cannon) {
        for (auto& d : ORTHO_DIRS) {
            int tr = row + d[0], tc = col + d[1];
            bool screen = false;
            while (inBounds(tr, tc)) {
                const Piece& t = b[tr][tc];
                if (!screen) {
                    if (t.empty()) out.push_back({{row, col}, {tr, tc}});
                    else screen = true;
                } else if (!t.empty()) {
                    if (t.color != color) out.push_back({{row, col}, {tr, tc}});
                    break;
                }
                tr += d[0]; tc += d[1];
            }
        }
    }
}

Piece makeMoveInPlace(Board& b, const Move& m) {
    Piece captured = b[m.to.row][m.to.col];
    b[m.to.row][m.to.col] = b[m.from.row][m.from.col];
    b[m.from.row][m.from.col] = Piece{};
    return captured;
}

void undoMoveInPlace(Board& b, const Move& m, Piece captured) {
    b[m.from.row][m.from.col] = b[m.to.row][m.to.col];
    b[m.to.row][m.to.col] = captured;
}

void generatePseudoMoveList(const Board& b, Color color, std::vector<Move>& out) {
    if (out.empty()) out.reserve(128);
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            const Piece& piece = b[r][c];
            if (piece.empty() || piece.color != color) continue;
            getPseudoMoves(b, r, c, out);
        }
}

void generateLegalMoves(const Board& b, Color color, std::vector<Move>& out) {
    Board scratch = b;
    if (out.empty()) out.reserve(128);
    std::vector<Move> pseudo;
    pseudo.reserve(32);
    for (int r = 0; r < BOARD_HEIGHT; ++r)
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            const Piece& piece = scratch[r][c];
            if (piece.empty() || piece.color != color) continue;
            pseudo.clear();
            getPseudoMoves(scratch, r, c, pseudo);
            for (const Move& m : pseudo) {
                Piece captured = makeMoveInPlace(scratch, m);
                Square kingSq;
                if (findKing(scratch, color, kingSq) && !isKingAttacked(scratch, color, kingSq)) out.push_back(m);
                undoMoveInPlace(scratch, m, captured);
            }
        }
}

}  // namespace BruteForce
