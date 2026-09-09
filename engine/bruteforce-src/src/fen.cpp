#include "fen.h"
#include <algorithm>
#include <cctype>
#include <sstream>
#include <utility>
#include <vector>

namespace BruteForce {

namespace {
PieceType letterToType(char lower) {
    switch (lower) {
        case 'r': return PieceType::Chariot;
        case 'n': return PieceType::Horse;
        case 'b': return PieceType::Elephant;
        case 'a': return PieceType::Advisor;
        case 'k': return PieceType::King;
        case 'c': return PieceType::Cannon;
        case 'p': return PieceType::Soldier;
        default:  return PieceType::None;
    }
}
char typeToLetter(PieceType t) {
    switch (t) {
        case PieceType::Chariot:  return 'r';
        case PieceType::Horse:    return 'n';
        case PieceType::Elephant: return 'b';
        case PieceType::Advisor:  return 'a';
        case PieceType::King:     return 'k';
        case PieceType::Cannon:   return 'c';
        case PieceType::Soldier:  return 'p';
        default: return '?';
    }
}
}  // namespace

std::optional<ParsedPosition> parseXiangqiFen(const std::string& fen) {
    std::istringstream ss(fen);
    std::string boardPart, turnPart;
    if (!(ss >> boardPart >> turnPart)) return std::nullopt;

    Board b{};
    int row = 0, col = 0;
    for (char ch : boardPart) {
        if (ch == '/') {
            if (col != BOARD_WIDTH || row >= BOARD_HEIGHT - 1) return std::nullopt;
            ++row; col = 0; continue;
        }
        if (row >= BOARD_HEIGHT) return std::nullopt;
        if (ch >= '1' && ch <= '9') {
            col += ch - '0';
            if (col > BOARD_WIDTH) return std::nullopt;
            continue;
        }
        if (col >= BOARD_WIDTH) return std::nullopt;
        PieceType t = letterToType(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
        if (t == PieceType::None) return std::nullopt;
        Color c = std::isupper(static_cast<unsigned char>(ch)) ? Color::Red : Color::Black;
        b[row][col] = {t, c};
        ++col;
    }

    if (row != BOARD_HEIGHT - 1 || col != BOARD_WIDTH) return std::nullopt;
    Color side;
    if (turnPart == "w") side = Color::Red;
    else if (turnPart == "b") side = Color::Black;
    else return std::nullopt;

    return ParsedPosition{b, side};
}

std::string boardToXiangqiFen(const Board& b, Color colorToMove) {
    std::string out;
    for (int r = 0; r < BOARD_HEIGHT; ++r) {
        if (r > 0) out += '/';
        int empty = 0;
        for (int c = 0; c < BOARD_WIDTH; ++c) {
            const Piece& p = b[r][c];
            if (p.empty()) { ++empty; continue; }
            if (empty > 0) { out += std::to_string(empty); empty = 0; }
            char letter = typeToLetter(p.type);
            out += (p.color == Color::Red) ? static_cast<char>(std::toupper(letter)) : letter;
        }
        if (empty > 0) out += std::to_string(empty);
    }
    out += ' ';
    out += (colorToMove == Color::Red ? 'w' : 'b');
    out += " - - 0 1";
    return out;
}

Square parseUciSquare(const std::string& s) {  // khớp :5594-5598
    if (s.size() != 2 || s[0] < 'a' || s[0] > 'i' || s[1] < '0' || s[1] > '9') return {-1, -1};
    int col = s[0] - 'a';
    int rank = s[1] - '0';
    return {9 - rank, col};
}

CsCode parseCheckStreakRootOption(const std::string& value) {
    std::vector<std::pair<int, int>> items;
    size_t pos = 0;
    while (pos < value.size()) {
        size_t comma = value.find(',', pos);
        std::string part = value.substr(pos, comma == std::string::npos ? std::string::npos : comma - pos);
        pos = comma == std::string::npos ? value.size() : comma + 1;
        if (part.size() < 4 || part[2] != ':') continue;   // "e5:2"; khác thì bỏ (kể cả "none")
        // parseUciSquare không tự kiểm tra ký tự, nên kiểm ở đây: giá trị lạ mà lọt qua sẽ thành
        // chỉ số ô ngoài bàn và làm số gói vô nghĩa.
        if (part[0] < 'a' || part[0] > 'i' || part[1] < '0' || part[1] > '9') continue;
        int count = 0;
        for (size_t k = 3; k < part.size(); ++k) {
            if (part[k] < '0' || part[k] > '9') { count = 0; break; }
            count = std::min(CS_COUNT_BASE - 1, count * 10 + (part[k] - '0'));
        }
        if (count <= 0) continue;
        if (count > CS_COUNT_BASE - 1) count = CS_COUNT_BASE - 1;
        items.push_back({squareIndex(parseUciSquare(part.substr(0, 2))), count});
    }
    // Phải xếp theo ô tăng dần: cùng một tập quân thì mọi nơi phải ra cùng một số, không thì khoá
    // bảng nhớ của cùng một thế cờ lại khác nhau.
    std::sort(items.begin(), items.end());
    CsCode code = 0, mult = 1;
    int slot = 0;
    for (auto& it : items) {
        if (slot >= CS_SLOTS) break;
        code += CsCode(it.first * CS_COUNT_BASE + it.second) * mult;
        mult *= CS_DIGIT_BASE;
        ++slot;
    }
    return code;
}

std::string squareToUci(Square s) {
    std::string out;
    out += static_cast<char>('a' + s.col);
    out += static_cast<char>('0' + (9 - s.row));
    return out;
}

std::string moveToUci(const Move& m) { return squareToUci(m.from) + squareToUci(m.to); }

std::optional<Move> parseUciMove(const std::string& s) {
    if (s.size() != 4) return std::nullopt;
    Move m;
    m.from = parseUciSquare(s.substr(0, 2));
    m.to = parseUciSquare(s.substr(2, 2));
    if (!inBounds(m.from.row, m.from.col) || !inBounds(m.to.row, m.to.col) || m.from == m.to) return std::nullopt;
    return m;
}

}  // namespace BruteForce
