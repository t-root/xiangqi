# Sửa phối hợp Native và Web

Nguyên nhân: trong `refreshGuide()`, khi không có tuyến chính hoặc cache hoàn tất cho nhánh hiện tại, cả `nativecombo` và `webcombo` đều được chuyển sang các hàm BF đơn. Pikafish không được khởi chạy ở nhánh này. Phân tích gốc vẫn có thể hiển thị kết quả của hai engine, trong khi hướng dẫn nhánh hiện tại chỉ có BF — đúng triệu chứng trong ảnh người dùng.

Đã sửa trong `xiangqi-analyzer.html`:

- Điều hướng nhánh live về `refreshPlayGuideMoveComposite()` để gọi hai engine song song.
- BF tiếp tục chạy tới kết luận, không bị tự dừng chỉ vì Pikafish trả ứng viên trước. Người dùng có thể chủ động chọn ứng viên bằng nút Chọn.
- Hiển thị riêng trạng thái đang chạy, có nước đạt mốc, đã kết thúc chưa có nước đạt mốc hoặc lỗi của từng engine.
- Sửa đơn vị: Pikafish dùng nửa nước; BF dùng nước/bên.
- Truyền cùng snapshot trạng thái cho các adapter, chặn gửi lệnh mới và nhận kết quả khi phiên hướng dẫn đã đổi.
- Giữ ngân sách Đỏ/Đen riêng khi hướng dẫn hòa; kết quả partial không được đưa thành nước đạt mốc.

Kiểm tra:

- `npm test`: đạt 16 nhóm regression engine/cầu nối, 6 nhóm regression phối hợp và bài kiểm tra cache.
- Kiểm tra điều hướng cả năm chế độ win/defense/hold/drawproof/play cho nativecombo và webcombo bằng mã thực với adapter giả lập.
- Kiểm tra trên trình duyệt qua chính `refreshGuide()` và hai engine thật, không có tuyến/cache sẵn:
  - Native: Pikafish depth 75 nửa nước; BF depth 4/4 nước/bên. Cả hai trả mate 4 và hai dòng trạng thái đạt mốc.
  - Web: Pikafish Web depth 46 nửa nước; BF Web depth 4/4 nước/bên. Cả hai trả mate 4 và hai dòng trạng thái đạt mốc.
- Thế thử: `9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1`. Giới hạn Pikafish trong bài thử là 1,5 giây; BF không giới hạn giờ ở nhánh live. Độ sâu đạt được có thể thay đổi theo máy/lần chạy.

Đã đóng gói lại `dist/XiangqiAnalyzer.fixed.exe`. `dist/XiangqiAnalyzer.exe` cũ được giữ nguyên. Không sửa thuật toán hay dựng lại binary BF/Pikafish trong lần sửa này; thay đổi nằm ở điều phối/giao diện và bộ kiểm tra.

Chưa tái hiện nguyên ván cờ trong ảnh vì không có FEN/lịch sử của ván đó. Kiểm tra engine thật dùng thế thử nêu trên; không thay thế việc kiểm thử mọi nhánh của mọi thế cờ.
