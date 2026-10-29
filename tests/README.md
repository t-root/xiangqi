# Bộ kiểm thử Xiangqi Analyzer

Đây là nơi tập trung các file kiểm thử, báo cáo và bản chạy chẩn đoán đã khôi phục sau lần dọn source. AI làm việc sau này nên bắt đầu từ tài liệu này.

## Chạy kiểm tra chính

Từ thư mục gốc dự án:

```powershell
node tests/run.cjs
```

Hoặc chạy `npm test` trong `engine/`. Lệnh này kiểm tra **engine đang dùng trong `engine/`**, không tự thay engine bằng bản cũ.

Yêu cầu: Node.js, các dependency đã cài trong `engine/node_modules`, BF và Pikafish hiện có. Các bài engine tạo tiến trình thử và WebSocket localhost trên cổng tạm; môi trường sandbox có thể cần quyền chạy tiến trình. Cài dependency bằng `npm ci` trong `engine/` nếu thiếu, không tự nâng phiên bản.

Để chỉ kiểm tra logic, không khởi chạy engine:

```powershell
node tests/composite-regression.cjs
node tests/cache-logic-smoke-test.js
```

## Danh mục

| File/thư mục | Mục đích |
|---|---|
| `crash-regression.cjs` | 22 nhóm kiểm tra BF/Pikafish, gồm nước gốc của proof hòa, Threads/hash BF, giữ TT qua các mức budget, EOF, stop, parser, cache session, lỗi cầu nối và restart qua WebSocket thật |
| `trial-verdict.cjs` | "Thử nước của tôi" chỉ kết luận giữ/mất khi đã chứng minh; hết giờ hoặc Pikafish không thấy mate = chưa chứng minh |
| `bf-node-count.cjs` | Lệnh `go budget` không phiên đếm nút từ 0: cùng thế cờ chạy nhiều lần phải báo cùng số nút |
| `bf-hash-sessions.cjs` | Phiên Brute-force tạo sau phiên đầu phải nhận đủ 1 GiB hash ban đầu, RAM hiển thị đúng và không tăng trưởng sớm |
| `composite-regression.cjs` | Kiểm tra phối hợp Pikafish + Brute-force, gia hạn Brute-force bằng warm session, cache miss, dự trữ RAM BF và loại kết quả cũ |
| `analysis-progress-visibility.cjs` | Kiểm tra parser/render telemetry Hash/RAM của Brute-force và trạng thái dòng engine sau phân tích |
| `cache-logic-smoke-test.js` | Kiểm tra trạng thái cache, mức chứng minh, retry và run ID |
| `engine-thread-settings.cjs` | Kiểm tra chính sách luồng cố định: Phân tích dùng 1 luồng; Duyệt/điều khiển dùng 2 luồng cho mỗi engine |
| `dynamic-hash-table.cpp` | Kiểm tra bảng băm phân đoạn: mục cũ còn tra được sau khi nở, checkpoint round-trip, clear và trigger nở ở ngưỡng 85% khi tìm kiếm |
| `pikafish-resources.cjs` | Kiểm tra giữ Threads/Hash giữa các lượt, đổi cấu hình và khởi tạo lại sau restart/kết nối mới |
| `pikafish-ktc.cjs` | Luật ktc trong Pikafish tự build (KtcBudget/KtcAttacker): số nước tính đòn khớp Brute-force trên 3 thế (gồm bên tấn công Đen), mặc định tắt, tắt lại không sót điểm cũ. Dùng `PIKA_EXE` để thử bản khác |
| `pikafish-ktc-find.cjs` | Công cụ chẩn đoán (không trong bộ chính): quét thế ngẫu nhiên tìm thế mà ktc đổi kết quả, đối chiếu Brute-force với Pikafish |
| `pikafish-cache-order.cjs` | Kiểm tra Full của cả 6 chế độ: lượt thấp trước, nhánh con mới, ưu tiên không vượt lượt và hai engine phối hợp lệch lượt |
| `pikafish-cache-adapter.cjs` | Chạy adapter Pika với kết quả sớm: không lỗi biến chưa khai báo, không khóa tìm kiếm ở độ sâu cũ |
| `browser/cache-repro.js` | FEN lỗi thực tế, Đỏ đi Pháo i0c0; kiểm tra tuần tự và tiến qua L1/L2 |
| `browser/` | Trang/đoạn mã kiểm thử phối hợp qua giao diện thật |
| `serve-composite-test.cjs` | Giao diện thử phối hợp; bridge riêng localhost:19989/19990, HTTP:19998 |
| `native/debug_root_streak.cpp` | Phép đối chiếu luật chuỗi chiếu, có main riêng |
| `build-native-tests.ps1` | Dựng binary chẩn đoán vào `binaries/`, không ghi đè engine chính |
| `native/piece_square_set.cpp` | Đối chiếu danh sách nước từ chỉ mục quân với cách quét toàn bàn, qua biến đổi và undo nước |
| `binaries/` | Bản lịch sử và bản chẩn đoán; xem nguồn phục hồi bên dưới |
| `reports/` | Báo cáo crash/phối hợp, danh mục phục hồi và kết quả kiểm tra |

## Kiểm tra trình duyệt

```powershell
node tests/serve-composite-test.cjs
```

Mở `http://127.0.0.1:19998/__combo-test`.

Chờ PASS cùng độ sâu/trạng thái của cả hai engine. Dùng engine thật trên thế thử mate 4; không có tuyến chính/cache sẵn. Pikafish có 1,5 giây, BF chạy tới kết luận. Đóng tab và dùng Ctrl+C để dừng máy chủ; chúng tự đóng sau 10 phút.

Để tái hiện lỗi cache sau nước Pháo Đỏ (1,1) → (7,1), dùng cùng máy chủ:

- `http://127.0.0.1:19998/__combo-test?cache=1`

Bài này dùng FEN người dùng cung cấp, mốc 4 nước ban đầu và lát Pika 600 ms.
PASS khi cả 20 nhánh đã hoàn tất hoặc qua L2, không có hai lượt đồng thời và không vượt lượt thấp.
Bài tự dừng cache khi PASS/FAIL, tối đa 90 giây; đây là kiểm tra tiến độ, không khẳng định mọi nhánh đều có nước thắng.

## Chẩn đoán native và crash lịch sử

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/build-native-tests.ps1
./tests/binaries/debug_root_streak.exe
./tests/binaries/piece_square_set.exe
node tests/crash-baseline.cjs
```

`crash-baseline.cjs` cố ý chạy BF cũ để tái hiện crash; mã thoát bất thường ở đó là dữ liệu chẩn đoán, **không phải** tiêu chí đạt của engine đã sửa. Không đưa baseline vào lệnh test mặc định.

Nguồn các binary:

- `bruteforce.audit.exe`: sao chép từ BF đã sửa đang có; khớp SHA-256 ghi trong báo cáo crash cũ.
- `bruteforce.before.exe`: trích tĩnh từ `dist/XiangqiAnalyzer.exe` cũ, không chạy launcher. Đây là bản trước sửa có sẵn trong gói cũ; chưa có hash của backup đã xóa để chứng minh khớp từng byte với backup đó.
- `bruteforce.paralleltest.exe`: **dựng lại từ mã nguồn hiện tại**, do không còn bản gốc của file đã xóa. Giữ tên chẩn đoán lịch sử; tên này không có nghĩa engine hiện tại đã bật tìm kiếm nhiều luồng.
- `debug_root_streak.exe`: dựng từ mã probe đã khôi phục, để chạy đối chiếu chuỗi chiếu.

## Tuyến xem trước theo thế cờ hiện tại

`node tests/analysis-engine-lines.cjs` kiểm tra hai tuyến gốc riêng của phối hợp,
lấy ngay nước công/thủ trên tuyến mà không tìm lại, và chuyển sang dò khi lệch tuyến hoặc khác lịch sử.
Với máy chủ `serve-composite-test.cjs`, mở `/__combo-test?initial-lines=1`
để kiểm tra hai engine thật: hai khung tuyến, chọn nguồn, đi ba bước,
xem tuyến kia rồi trở lại ván, và không gọi lại engine để hướng dẫn trên tuyến gốc.

`node tests/guide-line-current.cjs` và `node tests/guide-line-build.cjs` xác nhận mọi engine,
bao gồm Pikafish, chỉ giữ PV đã có để xem kết quả; hướng dẫn luôn truy vấn thế cờ thật,
giống Brute-force và không dựng/dự đoán tuyến nối tiếp.

`node tests/bruteforce-proof-line.cjs` kiểm tra ngân sách nút con của cả hai bên,
ngoại lệ ktc, giữ lịch sử và hủy lượt dò.

## Lịch sử đầu vào engine

- `node tests/history-regression.cjs`: lịch sử đầy đủ qua ăn quân, hoàn tác/đi tới, nhánh biến thể, khóa cache, phát hiện lịch sử lệch và lệnh đánh giá Pikafish. Có trong bộ chạy chính.
- Với máy chủ thử `serve-composite-test.cjs`, mở `/__combo-test?history=1`. Kiểm tra lệnh thực tế vào cả hai engine, nước trả về, can thiệp biến thể và mở lại hướng dẫn.
- `node tests/history-performance.cjs`: đo riêng chi phí chuẩn bị trạng thái/lệnh, ghi `tests/reports/history-performance.json`. Không đo tốc độ tìm nước, thời gian truyền lệnh hoặc lượng RAM thực tế.
- `node tests/https-dual-port.cjs`: chạy bản sao `engine/server.js` ở cổng thử; kiểm tra http:// và https:// (chứng chỉ tự ký, SAN gồm localhost + IP LAN) trên cùng một cổng, và bridge qua `ws://` lẫn `wss://…/ws/pikafish|bruteforce` (dùng cho điện thoại trên LAN). Có trong bộ chạy chính.

Lịch sử gốc giữ mọi nước kể từ thế nhập/đầu ván; tên `movesSinceCapture` được giữ cho tương thích snapshot nhưng không còn xóa khi ăn quân. `positionHistory` vẫn là cửa sổ rút gọn của bộ phân xử nội bộ. Không dùng cửa sổ này thay cho lịch sử đầu vào engine.

## Quy ước cho AI

- Chọn test phù hợp với thay đổi; thay đổi engine/cầu nối/phối hợp nên chạy bộ chính.
- Khi sửa adapter engine hoặc điều phối phiên live, chạy thêm bài trình duyệt tương ứng.
- Đặt test mới, fixture, báo cáo và binary test trong thư mục này.
- Không xóa test để làm kết quả xanh; báo rõ lỗi và giới hạn chưa kiểm tra.
- Các báo cáo trong `reports/` là kết quả tại thời điểm ghi, không thay thế lần chạy mới.
