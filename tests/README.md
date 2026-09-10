# Bộ kiểm thử Xiangqi Analyzer

Đây là nơi tập trung các file kiểm thử, báo cáo và bản chạy chẩn đoán đã khôi phục sau lần dọn source. AI làm việc sau này nên bắt đầu từ tài liệu này.

## Chạy kiểm tra chính

Từ thư mục gốc dự án:

```powershell
node tests/run.cjs
```

Hoặc chạy `npm test` trong `engine/`. Lệnh này kiểm tra **engine đang dùng trong `engine/`**, không tự thay engine bằng bản cũ.

Yêu cầu: Node.js, các dependency đã cài trong `engine/node_modules`, BF và Pikafish native hiện có. Bài native tạo tiến trình thử và WebSocket localhost trên cổng tạm; môi trường sandbox có thể cần quyền chạy tiến trình. Cài dependency bằng `npm ci` trong `engine/` nếu thiếu, không tự nâng phiên bản.

Để chỉ kiểm tra logic, không khởi chạy engine:

```powershell
node tests/composite-regression.cjs
node tests/cache-logic-smoke-test.js
```

## Danh mục

| File/thư mục | Mục đích |
|---|---|
| `crash-regression.cjs` | 16 nhóm kiểm tra BF/Pikafish, EOF, stop, parser, cache session, lỗi cầu nối và restart qua WebSocket thật |
| `composite-regression.cjs` | 6 nhóm kiểm tra phối hợp native/Web, cả hai engine được gọi, trạng thái riêng và loại kết quả cũ |
| `cache-logic-smoke-test.js` | Kiểm tra trạng thái cache, mức chứng minh, retry và run ID |
| `pikafish-resources.cjs` | Kiểm tra giữ Threads/Hash giữa các lượt, đổi cấu hình và khởi tạo lại sau restart/kết nối mới |
| `pikafish-cache-order.cjs` | Kiểm tra Full của cả 6 chế độ: lượt thấp trước, nhánh con mới, ưu tiên không vượt lượt và hai engine phối hợp lệch lượt |
| `pikafish-cache-adapter.cjs` | Chạy adapter Pika với kết quả sớm: không lỗi biến chưa khai báo, không khóa tìm kiếm ở độ sâu cũ |
| `browser/cache-repro.js` | FEN lỗi thực tế, Đỏ đi Pháo i0c0; kiểm tra tuần tự và tiến qua L1/L2 trên Native/Web |
| `browser/` | Trang/đoạn mã kiểm thử BF Web và phối hợp qua giao diện thật |
| `serve-crash-test.cjs` | Phục vụ bài BF Web trên localhost:19998 |
| `serve-composite-test.cjs` | Giao diện thử phối hợp; bridge riêng localhost:19989/19990, HTTP:19998 |
| `native/debug_root_streak.cpp` | Phép đối chiếu luật chuỗi chiếu, có main riêng |
| `build-native-tests.ps1` | Dựng binary chẩn đoán vào `binaries/`, không ghi đè engine chính |
| `binaries/` | Bản lịch sử và bản chẩn đoán; xem nguồn phục hồi bên dưới |
| `upstream/pikafish/tests/` | 6 file test nguyên bản lấy từ Git Pikafish |
| `reports/` | Báo cáo crash/phối hợp, danh mục phục hồi và kết quả kiểm tra |

## Kiểm tra trình duyệt

Chỉ chạy **một** trong hai máy chủ sau vì cùng dùng cổng 19998:

```powershell
node tests/serve-crash-test.cjs
```

Mở `http://127.0.0.1:19998/tests/browser/wasm-crash-test.html`, chờ PASS.

Hoặc:

```powershell
node tests/serve-composite-test.cjs
```

Mở lần lượt:

- `http://127.0.0.1:19998/__combo-test?mode=nativecombo`
- `http://127.0.0.1:19998/__combo-test?mode=webcombo`

Chờ PASS cùng độ sâu/trạng thái của cả hai engine. Dùng engine thật trên thế thử mate 4; không có tuyến chính/cache sẵn. Pikafish có 1,5 giây, BF chạy tới kết luận. Đóng tab và dùng Ctrl+C để dừng máy chủ; chúng tự đóng sau 10 phút.

Để tái hiện lỗi cache sau nước Pháo Đỏ (1,1) → (7,1), dùng cùng máy chủ:

- `http://127.0.0.1:19998/__combo-test?cache=1`
- `http://127.0.0.1:19998/__combo-test?cache=1&engine=pikafishweb`

Bài này dùng FEN người dùng cung cấp, mốc 4 nước ban đầu và lát Pika 600 ms.
PASS khi cả 20 nhánh đã hoàn tất hoặc qua L2, không có hai lượt đồng thời và không vượt lượt thấp.
Bài tự dừng cache khi PASS/FAIL, tối đa 90 giây; đây là kiểm tra tiến độ, không khẳng định mọi nhánh đều có nước thắng.

## Chẩn đoán native và crash lịch sử

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/build-native-tests.ps1
./tests/binaries/debug_root_streak.exe
node tests/crash-baseline.cjs
```

`crash-baseline.cjs` cố ý chạy BF cũ để tái hiện crash; mã thoát bất thường ở đó là dữ liệu chẩn đoán, **không phải** tiêu chí đạt của engine đã sửa. Không đưa baseline vào lệnh test mặc định.

Nguồn các binary:

- `bruteforce.audit.exe`: sao chép từ BF đã sửa đang có; khớp SHA-256 ghi trong báo cáo crash cũ.
- `bruteforce.before.exe`: trích tĩnh từ `dist/XiangqiAnalyzer.exe` cũ, không chạy launcher. Đây là bản trước sửa có sẵn trong gói cũ; chưa có hash của backup đã xóa để chứng minh khớp từng byte với backup đó.
- `bruteforce.paralleltest.exe`: **dựng lại từ mã nguồn hiện tại**, do không còn bản gốc của file đã xóa. Giữ tên chẩn đoán lịch sử; tên này không có nghĩa engine hiện tại đã bật tìm kiếm nhiều luồng.
- `debug_root_streak.exe`: dựng từ mã probe đã khôi phục, để chạy đối chiếu chuỗi chiếu.

## Tuyến xem trước theo thế cờ hiện tại

`node tests/guide-line-build.cjs` kiểm tra luân phiên hai bên, hết mốc, kết quả không hợp lệ và hủy kết quả cũ.
Với máy chủ `serve-composite-test.cjs`, mở `/__combo-test?line=1&engine=...`, thay engine bằng
`pikafish`, `pikafishweb`, `nativecombo`, hoặc `webcombo`.
Bài thử dùng thế mate 4, kiểm tra tuyến kết thúc trong mốc, bàn thật không đổi và bảng cache giữ nguyên.
Phối hợp chỉ gọi Pika để dựng tuyến. `bruteforce`/`bruteforceweb` kiểm tra dựng lại sau mỗi nước đã tắt,
cache proof được dùng để lấy một nước thủ, kho riêng engine được đọc khi kho chung thiếu,
và line giữ nguyên khi hướng dẫn. Thêm `&initial=1` để kiểm tra BF vẫn dựng line ban đầu
sau phân tích thắng, rồi chơi hai nước không dựng lại. Thêm tiếp `&draw=1` để kiểm tra
line ban đầu của kết quả hòa. Chạy cả hai bản `bruteforce` và `bruteforceweb`.
Thêm `&screenshot=1` với hai chế độ BF để kiểm tra thế cờ từ ảnh lỗi ngày 10/09/2026:
ngân sách gốc 2/2, sau nước Đen phải hỏi BF 2/1, có nước hướng dẫn và lần sau dùng cache ngay.
`node tests/bruteforce-proof-line.cjs` cũng kiểm tra ngân sách nút con của cả hai bên,
ngoại lệ ktc, giữ lịch sử và hủy lượt dò.
Riêng Pika, fixture chỉ giữ một nước của mỗi PV để buộc chạy nhánh dò nối tiếp.
Thêm `&early-preview=1` để bấm xem nước đầu trước khi tuyến được dựng, ngay trong Hướng dẫn khi chưa mở ván chơi.
Thêm `&defense=1` để kiểm tra lượt Đen sau Pháo Đỏ `a0a4`, mốc còn 3 nước; tuyến có thể hết mốc mà chưa mate.

## Test upstream


Các file tại `upstream/pikafish/tests/` được giữ nguyên từ commit `2c5c998c211d524d26c38e7e3e71d51bc24cbe64`. Bản sao này còn các bài Stockfish/chess/Chess960, tên executable `stockfish`, và yêu cầu Bash/expect/Python/Valgrind tùy bài. **Không chạy cả thư mục này như bộ test cờ tướng mặc định.** Đọc từng bài và điều chỉnh môi trường phù hợp trước; bộ native riêng phía trên là bộ dùng cho ứng dụng này.

## Lịch sử đầu vào engine

- `node tests/history-regression.cjs`: lịch sử đầy đủ qua ăn quân, hoàn tác/đi tới, nhánh biến thể, khóa cache, phát hiện lịch sử lệch và lệnh đánh giá Pikafish Native/Web. Có trong bộ chạy chính.
- Với máy chủ thử `serve-composite-test.cjs`, mở `/__combo-test?history=1&mode=nativecombo`, rồi `mode=webcombo`. Kiểm tra lệnh thực tế vào cả hai engine, nước trả về, can thiệp biến thể và mở lại hướng dẫn.
- `node tests/history-performance.cjs`: đo riêng chi phí chuẩn bị trạng thái/lệnh, ghi `tests/reports/history-performance.json`. Không đo tốc độ tìm nước, thời gian truyền lệnh hoặc lượng RAM thực tế.

Lịch sử gốc giữ mọi nước kể từ thế nhập/đầu ván; tên `movesSinceCapture` được giữ cho tương thích snapshot nhưng không còn xóa khi ăn quân. `positionHistory` vẫn là cửa sổ rút gọn của bộ phân xử nội bộ. Không dùng cửa sổ này thay cho lịch sử đầu vào Native/Web.

## Quy ước cho AI

- Chọn test phù hợp với thay đổi; thay đổi engine/cầu nối/phối hợp nên chạy bộ chính.
- Khi sửa adapter Web hoặc điều phối phiên live, chạy thêm bài trình duyệt tương ứng.
- Đặt test mới, fixture, báo cáo và binary test trong thư mục này.
- Không xóa test để làm kết quả xanh; báo rõ lỗi và giới hạn chưa kiểm tra.
- Các báo cáo trong `reports/` là kết quả tại thời điểm ghi, không thay thế lần chạy mới.
