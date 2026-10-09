# Kiểm tra crash engine — 05/09/2026

Đã tái hiện hai crash trên BF native cũ, sửa mã nguồn, dựng lại BF native/Web và đóng gói bản ứng dụng mới. Các kiểm tra cuối đều đạt. Chưa có crash dump từ phiên sử dụng của người dùng, vì vậy chưa thể khẳng định mọi lần crash trước đây đều có cùng nguyên nhân với các ca đã tái hiện.

## Bằng chứng trước khi sửa

Chạy `node engine/crash-baseline.cjs` từ thư mục dự án. Script mặc định dùng bản cũ đã giữ tại `engine/crash-audit-backup/bruteforce.before.exe`.

| Tình huống | Kết quả thực tế trên bản cũ | Giải thích trong mã nguồn |
|---|---|---|
| Gửi position/go rồi đóng stdin | Exit 3221226505 = `0xC0000409` | `main()` kết thúc trong khi `g_searchThread` vẫn joinable; hủy đối tượng thread gây terminate/fail-fast. Mã này không tự chứng minh tràn stack. |
| Gửi `position fen … moves zzzz` | Exit 3221225477 = `0xC0000005` | Bộ đọc nước đi không kiểm tra tọa độ; `handlePosition()` đọc/ghi bàn cờ ngoài giới hạn. |
| Gửi go/stop/quit liên tiếp | Vẫn tìm tới chiếu bí ở budget 4 | Worker đặt lại `g_cancelled=false` sau khi luồng lệnh đã gửi stop, làm mất yêu cầu dừng. |

FEN dùng trong ba ca: `9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1`.

## Các điểm đã sửa

1. **Vòng đời BF native:** đặt cờ hủy trước khi tạo worker; join khi EOF; dừng trước khi xóa lịch sử ở `ucinewgame`; bắt ngoại lệ của worker và lỗi tạo luồng. File: `engine/bruteforce-src/src/main.cpp`.
2. **Đầu vào:** kiểm tra đủ 10 hàng × 9 cột của FEN, định dạng và giới hạn tọa độ nước đi, nước đi hợp lệ. Không tìm tiếp trên thế cũ sau khi nạp thế mới thất bại. Giới hạn budget, depth và thời gian để tránh độ sâu/số học không kiểm soát. File: `fen.cpp`, `main.cpp`.
3. **Kết thúc sau stop:** BF trả `outcome partial` và `bestmove (none)` cho lượt bị hủy; giao diện và cầu nối không còn chờ một kết quả kết thúc không bao giờ được phát.
4. **RAM của session:** trước đây mỗi session cấp ít nhất 16 MiB TT, giao diện không gửi `search cancel`. Nay giao diện giữ tối đa 12 session mỗi loại BF, giải phóng phiên hoàn tất/hủy; native chặn ở 16. Không cấp thêm một TT tạm không dùng khi tiếp tục session. Phiên bị giải phóng có thể phải dò lại khi quay lại nhánh đó; đây là đánh đổi để bộ nhớ có giới hạn.
5. **Cache bị ngắt:** không ghi điểm từ nhánh bị hủy/hết giờ vào TT/witness để tái sử dụng như kết quả đã chứng minh. Chặn tràn bộ đếm heuristic tích lũy. File: `search.cpp`.
6. **Đáp ứng deadline:** kiểm tra hủy/thời gian cả trong quiescence, các nút positional và vòng lặp nước gốc. File: `positional.cpp`.
7. **Cầu nối Node dùng chung:** xử lý lỗi spawn, lỗi stdin/EPIPE và sự kiện close; báo mã lỗi; tránh xử lý lại tiến trình cũ; nhận biết cả `search slice/resume` là một lượt tìm kiếm; dừng phiên không còn người theo dõi. File: `engine/server.js`.
8. **Đổi thế khi còn đang tìm:** xếp lệnh chờ sau stop/bestmove trước khi gửi position/setoption/go tiếp theo. Pikafish giải phóng/thay danh sách trạng thái trong `Engine::set_position`, nên không được gọi khi search cũ còn sử dụng. Đã bảo vệ ở cầu nối; không sửa thuật toán lõi Pikafish.
9. **Giao diện:** chờ readyok cả khi socket BF đã mở; đăng ký listener trước isready ở Pikafish; từ chối lỗi giao thức BF thay vì coi `bestmove none` là hòa; không nhận lệnh từ socket đã bị thay. Cập nhật chữ ký cache BF để không dùng kết quả cache đời cũ.
10. **BF Web:** bắt và báo abort của WASM, kiểm tra cấp phát bộ nhớ cho lệnh, bật xử lý ngoại lệ khi build; dựng lại JS/WASM và đổi phiên bản tải. Các dòng info/PV của BF được xuất trọn dòng dưới khóa để tránh lẫn với readyok.
11. **Build native:** bỏ `-march=native` của BF để không ràng buộc bản phát hành vào bộ lệnh riêng của CPU dựng; thêm `-pthread`. Pikafish hiện vẫn là bản BMI2.

## Kiểm tra đã thực hiện

`npm test` trong thư mục `engine` — **exit 0**, gồm **16 nhóm regression** và bài kiểm tra cache hiện có:

- EOF khi worker đang chạy; 40 lượt go/stop tức thời liên tiếp.
- Tọa độ sai, nước đi sai, FEN sai và khả năng tiếp tục nhận thế hợp lệ sau lỗi.
- 30 lượt positional/ucinewgame liên tiếp; budget/depth/movetime cực lớn.
- Deadline positional; giới hạn session và giải phóng session.
- Warm slices cuối cùng cho cùng nước chiếu bí `a0f0` như tìm mới ở thế kiểm tra.
- Spawn thất bại, stdin hỏng, tránh restart trùng, bỏ output từ tiến trình cũ.
- Session bị bỏ khi ngắt kết nối; socket cũ không còn được gửi lệnh.
- Chờ bestmove trước khi đổi trạng thái engine.
- **WebSocket thật** trên cổng tạm: go/stop/isready, chủ động tắt tiến trình thử nghiệm, nhận thông báo crash, tự restart và tìm được chiếu bí ở lượt kế tiếp.
- Phân tích cú pháp script HTML/server; Pikafish native handshake, tìm kiếm, stop và EOF.
- `cache-logic-smoke-test.js`: đạt; sửa đường dẫn để chạy được từ thư mục engine qua npm test.

**BF Web trên trình duyệt:** trang `engine/wasm-crash-test.html` hiển thị PASS cho tìm chiếu bí, 10 lượt stop tức thời, nước đi lỗi và session create/slice/cancel. Có thể chạy lại bằng `node engine/serve-crash-test.cjs`, rồi mở `http://127.0.0.1:19998/engine/wasm-crash-test.html`. Máy chủ thử chỉ nghe localhost và tự đóng sau 10 phút.

## Bản chạy

- `engine/bruteforce-src/src/bruteforce.exe`: bản mới, dùng khi chạy từ source.
- `engine/bruteforce/bruteforce.exe`: đã đồng bộ bản mới.
- SHA-256 của cả hai: `EA762931FC0A544FF6DCA0DC9753BF6F16039E09C640ECEC0E6823F041C19EC3`.
- `bruteforce-web/bruteforce.js` và `.wasm`: đã dựng lại từ cùng mã C++.
- `dist/XiangqiAnalyzer.fixed.exe`: ứng dụng đã đóng gói lại. Giữ nguyên `dist/XiangqiAnalyzer.exe` cũ; cần chọn bản **fixed** để dùng bản sửa.
- `engine/crash-audit-backup/bruteforce.before.exe`: BF cũ để đối chiếu/tái hiện.

## Giới hạn kết luận

Đã đọc các đường mã liên quan engine: giao thức, tiến trình/luồng, parser, move generation, search/TT, positional, lịch sử/luật chiếu, session cache, adapter Web và build/đóng gói. Không coi đây là chứng minh toàn bộ mã nguồn, mọi thế cờ và mọi cấu hình máy đều hết lỗi.

Chưa kiểm thử dài hàng giờ, chưa kiểm tra mọi chế độ chơi qua giao diện chính và chưa chạy ma trận CPU. Pikafish Web chưa được kiểm thử end-to-end trong đợt này. Bản ứng dụng fixed đã build thành công nhưng chưa khởi chạy toàn bộ launcher, vì launcher tự tắt tiến trình đang chiếm cổng và sửa firewall; thay vào đó đã kiểm thử cầu nối thật trên cổng riêng. Không dùng kết quả kiểm tra này để khẳng định đã tái hiện đúng crash ngẫu nhiên của phiên sử dụng trước nếu chưa có log/dump tương ứng.
