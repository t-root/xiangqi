// Đối chiếu luật chuỗi chiếu của Brute-force với Engine Web: CÙNG tám thế cờ, cùng thứ tự, in ra
// cùng một định dạng để so từng dòng với bản chạy trên trình duyệt (.cs-probe.js của app).
// Trọng tâm: quân giữ chuỗi là quân ĐANG THẬT SỰ chiếu, nên chiếu mở/chiếu đôi phải tính cho Xe,
// không phải cho quân vừa đi.
//
// Dựng riêng, KHÔNG nằm trong danh sách nguồn của build-xiangqi.bat (file này có main() riêng):
//   g++ -std=c++17 -O1 -static -o cs_test.exe debug_root_streak.cpp movegen.cpp rules.cpp hash.cpp fen.cpp
#include "fen.h"
#include "rules.h"
#include "movegen.h"

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

using namespace BruteForce;

namespace {

constexpr CsSide RESTRICTED = CsSide::Red;
constexpr int LIMIT = 2;

Board emptyBoard() { return Board{}; }

void put(Board& b, int r, int c, PieceType type, Color color) { b[r][c] = Piece{type, color}; }

Move mv(int fr, int fc, int tr, int tc) { return Move{{fr, fc}, {tr, tc}}; }

// Gói tay một tập (ô, số lần) — dùng để dựng trạng thái "đã có sẵn" cho từng phép thử.
CsCode pack(std::vector<std::pair<int, int>> items) {
    std::sort(items.begin(), items.end());
    CsCode code = 0, mult = 1;
    for (auto& it : items) {
        code += CsCode(it.first * CS_COUNT_BASE + it.second) * mult;
        mult *= CS_DIGIT_BASE;
    }
    return code;
}

std::string show(CsCode code) {
    if (code < 0) return "PHAM LUAT (-1)";
    if (code == 0) return "khong co chuoi (0)";
    std::string out;
    CsCode rest = code;
    while (rest > 0) {
        int digit = int(rest % CS_DIGIT_BASE);
        rest /= CS_DIGIT_BASE;
        if (digit == 0) continue;
        int sq = digit / CS_COUNT_BASE, n = digit % CS_COUNT_BASE;
        char buf[64];
        snprintf(buf, sizeof(buf), "sq%d(r%dc%d)=%d", sq, sq / BOARD_WIDTH, sq % BOARD_WIDTH, n);
        if (!out.empty()) out += " + ";
        out += buf;
    }
    return out;
}

int g_fails = 0;

void run(const char* name, Board b, Move move, CsCode prior, const char* expect) {
    makeMoveInPlace(b, move);
    Square oppKing;
    findKing(b, Color::Black, oppKing);
    CsCode got = csAdvanceAfterMove(b, prior, move, Color::Red, oppKing, RESTRICTED, LIMIT);
    bool ok = show(got) == expect;
    if (!ok) ++g_fails;
    printf("%s%s\n      duoc : %s\n      mong : %s\n", ok ? "OK  " : "SAI ", name, show(got).c_str(), expect);
}

// Xe Đỏ (9,4) bị chính Mã Đỏ chắn trên cột 4; Tướng Đen (0,4).
Board boardHorseBlocks(int horseRow) {
    Board b = emptyBoard();
    put(b, 0, 4, PieceType::King, Color::Black);
    put(b, 9, 3, PieceType::King, Color::Red);
    put(b, 9, 4, PieceType::Chariot, Color::Red);
    put(b, horseRow, 4, PieceType::Horse, Color::Red);
    return b;
}

Board boardRookRow() {
    Board b = emptyBoard();
    put(b, 0, 4, PieceType::King, Color::Black);
    put(b, 9, 3, PieceType::King, Color::Red);
    put(b, 0, 0, PieceType::Chariot, Color::Red);
    return b;
}

}  // namespace

int main() {
    printf("PROBE-BEGIN\n");

    run("T1 chieu doi (Ma + Xe mo hinh)", boardHorseBlocks(2), mv(2, 4, 1, 2), 0,
        "sq11(r1c2)=1 + sq85(r9c4)=1");

    run("T2 chieu mo thuan (chi Xe chieu)", boardHorseBlocks(2), mv(2, 4, 4, 5), 0,
        "sq85(r9c4)=1");

    run("T3 Xe tiep tuc chuoi qua quan khac", boardHorseBlocks(3), mv(3, 4, 5, 5), pack({{85, 1}}),
        "sq85(r9c4)=2");

    run("T4 Xe chieu luot thu 3 -> pham luat", boardHorseBlocks(3), mv(3, 4, 5, 5), pack({{85, 2}}),
        "PHAM LUAT (-1)");

    run("T5 chinh Xe di tiep", boardRookRow(), mv(0, 0, 0, 1), pack({{0, 1}}),
        "sq1(r0c1)=2");

    Board rookAndHorse = boardRookRow();
    put(rookAndHorse, 2, 4, PieceType::Horse, Color::Red);
    run("T6 Ma vao chieu, Xe san dang chieu", rookAndHorse, mv(2, 4, 1, 2), pack({{0, 1}}),
        "sq0(r0c0)=2 + sq11(r1c2)=1");

    run("T7 nuoc khong chieu -> dut chuoi", boardHorseBlocks(2), mv(9, 3, 8, 3), pack({{85, 1}}),
        "khong co chuoi (0)");

    // Chiếu đôi mà MỘT trong hai quân đã dùng hết lượt thì vẫn phạm luật — không được vì quân kia
    // mới chiếu lần đầu mà tha. T10 quân hết lượt là Xe (đứng yên, sẵn đang chiếu), T11 là Mã (vừa
    // đi, nên bộ đếm cũ của nó nằm ở ô XUẤT PHÁT 22 = r2c4).
    Board rookAtLimit = boardRookRow();
    put(rookAtLimit, 2, 4, PieceType::Horse, Color::Red);
    run("T10 chieu doi, Xe da du 2 luot -> pham luat", rookAtLimit, mv(2, 4, 1, 2), pack({{0, 2}}),
        "PHAM LUAT (-1)");

    Board horseAtLimit = boardRookRow();
    put(horseAtLimit, 2, 4, PieceType::Horse, Color::Red);
    run("T11 chieu doi, Ma vua di da du 2 luot -> pham luat", horseAtLimit, mv(2, 4, 1, 2),
        pack({{22, 2}}), "PHAM LUAT (-1)");

    CsCode packed = pack({{85, 2}, {11, 1}});
    printf("T8 goi/mo goi: %lld -> %s | csCountAt(85)=%d csCountAt(11)=%d csMaxCount=%d\n",
           (long long) packed, show(packed).c_str(), csCountAt(packed, 85), csCountAt(packed, 11), csMaxCount(packed));

    // T9: đọc option gốc phải ra ĐÚNG số mà app gói (chuỗi "c8:1,e0:2" là bản app in ra cho tập này).
    CsCode fromOption = parseCheckStreakRootOption("c8:1,e0:2");
    bool okOption = fromOption == packed;
    if (!okOption) ++g_fails;
    printf("%sT9 doc option \"c8:1,e0:2\"\n      duoc : %lld (%s)\n      mong : %lld\n",
           okOption ? "OK  " : "SAI ", (long long) fromOption, show(fromOption).c_str(), (long long) packed);

    bool okNone = parseCheckStreakRootOption("none") == 0;
    if (!okNone) ++g_fails;
    printf("%sT9b doc option \"none\" -> 0\n", okNone ? "OK  " : "SAI ");

    printf("PROBE-END\n");
    printf(g_fails == 0 ? "TAT CA KHOP\n" : "CO %d PHEP THU SAI\n", g_fails);
    return g_fails == 0 ? 0 : 1;
}
