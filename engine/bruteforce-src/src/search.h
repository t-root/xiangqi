#ifndef BRUTEFORCE_SEARCH_H
#define BRUTEFORCE_SEARCH_H

#include "types.h"
#include "movegen.h"
#include "hash.h"
#include "tt.h"
#include "rules.h"
#include <vector>
#include <atomic>
#include <chrono>
#include <optional>
#include <unordered_map>

namespace BruteForce {

// Ghi nước đã chọn của các nút mate ngay trong lượt chứng minh. TT chỉ giữ
// một nước và điểm để cắt tỉa, nên TT-hit không mang được phần đuôi PV ra UI.
// Bảng witness nhỏ này cho phép ghép lại trọn tuyến đã chứng minh, không dò lại.
struct MateWitnessKey {
    i32 h1, h2;
    int redBudget, blackBudget;
    CsCode csRed, csBlack;
    bool isRed;

    bool operator==(const MateWitnessKey& other) const {
        return h1 == other.h1 && h2 == other.h2 && redBudget == other.redBudget &&
            blackBudget == other.blackBudget && csRed == other.csRed &&
            csBlack == other.csBlack && isRed == other.isRed;
    }
};

struct MateWitnessKeyHash {
    size_t operator()(const MateWitnessKey& key) const {
        uint64_t h = static_cast<uint32_t>(key.h1);
        h = (h * 0x9E3779B185EBCA87ULL) ^ static_cast<uint32_t>(key.h2);
        h = (h * 0xC2B2AE3D27D4EB4FULL) ^ static_cast<uint32_t>(key.redBudget);
        h = (h * 0x165667B19E3779F9ULL) ^ static_cast<uint32_t>(key.blackBudget);
        h ^= static_cast<uint64_t>(key.csRed) * 0x9E3779B97F4A7C15ULL;
        h ^= static_cast<uint64_t>(key.csBlack) * 0xBF58476D1CE4E5B9ULL;
        return static_cast<size_t>(h ^ (key.isRed ? 0x94D049BB133111EBULL : 0));
    }
};

struct ScoredMove : Move {
    Piece piece, captured;
    i64 ord = 0;
};

// Trạng thái RIÊNG của một luồng tìm kiếm — khớp việc mỗi Worker JS có TT/mateHistoryScores/
// mateKillerA/B ĐỘC LẬP (xem báo cáo khảo sát §8, §6). Không dùng biến toàn cục kiểu JS để mỗi
// std::thread native có bản sao riêng, không cần khoá (mutex) trong đường nóng của tìm kiếm.
struct MateSearchState {
    TranspositionTable tt;
    std::vector<i32> mateHistoryScores = std::vector<i32>(NUM_SQUARES * NUM_SQUARES, 0);
    std::vector<i32> mateKillerA = std::vector<i32>(MATE_MAX_PLY, 0);
    std::vector<i32> mateKillerB = std::vector<i32>(MATE_MAX_PLY, 0);

    CsSide restrictedSide = CsSide::None;   // khớp checkStreakRestrictedColor
    int checkStreakLimit = CHECK_STREAK_DEFAULT;
    bool ktcBudgetOn = false;
    Color ktcExemptColor = Color::None;

    i64 nodeCounter = 0;
    std::atomic<bool>* cancelled = nullptr;  // trỏ tới cờ huỷ dùng chung (nullptr = không bao giờ huỷ)

    // Hạn giờ THẬT của "go budget ... movetime N" — thiếu cái này thì vòng lặp NGOÀI (runGoBudget)
    // chỉ kiểm tra giờ GIỮA các mức budget, một mức budget đang chạy dở có thể tràn qua hạn giờ rất
    // lâu (đã thấy thật: xin 3s nhưng chạy tới 15s) — cùng lỗi và cùng cách sửa đã áp cho
    // PositionalSearchState (positional.h) trước đây, giờ áp nốt cho nhánh quét cạn thắng ép.
    std::optional<std::chrono::steady_clock::time_point> deadline;
    std::unordered_map<MateWitnessKey, i32, MateWitnessKeyHash> mateWitness;

    bool isCancelled() const { return cancelled && cancelled->load(std::memory_order_relaxed); }
    bool timeUp() const { return deadline && std::chrono::steady_clock::now() > *deadline; }

    void reset() {  // khớp resetSearchTables() (:1578-1582)
        tt.clear();
        std::fill(mateHistoryScores.begin(), mateHistoryScores.end(), 0);
        std::fill(mateKillerA.begin(), mateKillerA.end(), 0);
        std::fill(mateKillerB.begin(), mateKillerB.end(), 0);
        mateWitness.clear();
    }
};

struct SearchResult {
    i32 score = 0;
    std::vector<Move> line;
};

// Khớp negamaxForcedMateGen (:3301-3409) — lõi tìm kiếm quét cạn chiếu bí, chính xác tuyệt đối
// (không cắt tỉa suy đoán/heuristic nào ngoài alpha-beta + cắt theo khoảng cách chiếu bí, cả hai
// đều KHÔNG làm đổi kết quả cuối cùng).
SearchResult negamaxForcedMateGen(Board& b, Color color, int redBudget, int blackBudget,
                                    int pliesFromRoot, i32 alpha, i32 beta,
                                    i32 h1, i32 h2, CsCode csRed, CsCode csBlack,
                                    MateSearchState& st);

// Khớp negamaxForcedMateRootSubsetGen (:3418+) — dùng khi chia nước gốc cho nhiều luồng.
SearchResult negamaxForcedMateRootSubsetGen(Board& b, Color color, int redBudget, int blackBudget,
                                              const std::vector<Move>& subsetMoves, i32 alpha, i32 beta,
                                              i32 h1, i32 h2, CsCode csRed, CsCode csBlack,
                                              MateSearchState& st);

// Ghép lại PV đầy đủ chỉ bằng các nước đã ghi ngay trong lần chứng minh mate.
// Trả rỗng nếu dữ liệu witness thiếu; caller khi đó vẫn có đường dự phòng cũ.
std::vector<Move> rebuildMateWitnessLine(Board b, Color color, int redBudget, int blackBudget,
                                         CsCode csRed, CsCode csBlack, MateSearchState& st);

// Tạo danh sách nước gốc hợp lệ, đã sắp theo đúng heuristic của dò chiếu bí. Hàm này được
// tách ra để main.cpp có thể chia các nước gốc cho nhiều luồng mà không đổi luật hay thứ tự ưu tiên.
std::vector<Move> forcedMateRootMoves(Board& b, Color color, MateSearchState& st);

struct ProbeResult { bool mate = false; i32 score = 0; std::vector<Move> line; };

// Khớp KTC_DEFENDER_SLACK / ktcSearchBudgets (xiangqi-analyzer.html): bên thủ được thêm ngân sách
// vì mỗi nước ktc (chạy Tướng, không trừ) của tấn công kéo theo một nước đáp — hai bên cùng k thì
// lối "5 nước thật / 3 nước tính đòn" bị cắt sớm, chỉ còn lối 4 nước không ktc (sai thế cờ 48).
constexpr int KTC_DEFENDER_SLACK = 16;

inline void ktcSearchBudgets(Color attacker, int redBudget, int blackBudget, bool ktcOn,
                             int& outRed, int& outBlack) {
    if (!ktcOn) { outRed = redBudget; outBlack = blackBudget; return; }
    int k = (attacker == Color::Red) ? redBudget : blackBudget;
    if (k < 1) k = 1;
    outRed = (attacker == Color::Red) ? k : k + KTC_DEFENDER_SLACK;
    outBlack = (attacker == Color::Black) ? k : k + KTC_DEFENDER_SLACK;
}

// Khớp probeForcedMateAlphaBetaGen (:3689+): 2 lượt hỏi trong cửa sổ alpha-beta bó sát ngưỡng
// chiếu bí — "color có thắng ép không", rồi nếu không thì "color có bị ép thua không".
ProbeResult probeForcedMateAlphaBetaGen(Board& b, Color color, int redBudget, int blackBudget,
                                          CsCode csRed, CsCode csBlack, MateSearchState& st);

}  // namespace BruteForce

#endif  // BRUTEFORCE_SEARCH_H
