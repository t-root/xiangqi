# Dựng tuyến hiện tại — 2026-09-09

## Ưu tiên phân tích và cache, tuyến chạy lúc rảnh

Thay cơ chế nhường lượt trước đây: tuyến không được giữ Pika trước nhánh cache kế tiếp. Khi hàng đợi cache đang hoạt động, tuyến chờ và ghi rõ trạng thái chờ Pika rảnh. Job cache mới hủy tuyến đang chạy để tiếp tục ngay; thao tác dừng runtime khi phân tích mới cũng vô hiệu hóa tuyến cũ. Bộ `node tests/run.cjs` PASS, bao gồm kiểm tra cache không chờ tuyến và hủy tuyến trước dispatch.

## Sửa trường hợp chỉ thấy một nước khi xem trước

Bỏ điều kiện ngăn lên lịch dựng khi đang xem trước. Lưu vị trí engine thật ngay lúc mở xem trước, kể cả khi chỉ có Hướng dẫn và chưa mở ván chơi. Dựng từ vị trí đã lưu; bàn xem trước cập nhật cùng bước đang hiển thị, không trở thành gốc tìm kiếm mới.

`--logic` PASS. Trình duyệt với `early-preview=1`: Native/Web đều PASS 7 ply tại FEN mate 4. Native với thêm `defense=1` (sau `a0a4`, Đen đi, còn 3 nước) PASS dựng 6 ply, giữ bảng cache và khôi phục bàn thật. Bài sau không khẳng định mate nếu hết mốc mà chưa đạt thế kết thúc.

## Điều chỉnh theo yêu cầu mới: chỉ Pika, giữ bảng cache

- Chỉ Pika Native/Web được dựng tuyến, kể cả khi chọn Phối hợp; BF không có nút/tác vụ dựng tuyến mới.
- Chờ lượt cache Pika đang chạy hoàn tất, chặn nhánh Pika kế tiếp trong lúc dựng tuyến, sau đó cho hàng đợi tiếp tục. Không gọi thao tác xóa báo cáo/hủy và dựng lại cache; BF có hàng đợi riêng.
- `node tests/run.cjs`: PASS. Test mới kiểm tra chờ, nhả lượt, hủy khi đổi token, chọn đúng Pika trong Phối hợp và BF không dispatch.
- Trình duyệt `nativecombo`: PASS qua Pika, 7 ply, bảng cache và bàn thật giữ nguyên.
- Trình duyệt `webcombo`: PASS qua Pika Web, 7 ply, bảng cache và bàn thật giữ nguyên.
- Trình duyệt `bruteforceweb`: PASS, tính năng dựng tuyến tắt.
- Bài trình duyệt chạy một job cache Pika thật trước khi dựng tuyến; so sánh nguyên nội dung DOM status/details và đối tượng báo cáo trước/sau dựng. Chưa phải bài chạy toàn bộ cây Full lớn đồng thời.

## Kết quả bản đầu, trước khi bỏ BF khỏi tính năng

Đã chạy `node tests/run.cjs`: tất cả đạt, gồm hủy kết quả cũ, giới hạn nước còn lại và nước không hợp lệ trong `guide-line-build.cjs`.

Trình duyệt dùng máy chủ riêng `serve-composite-test.cjs`, engine hiện tại:

| Engine | Kết quả bài mate 4 |
| --- | --- |
| Pikafish Native | PASS, 7 ply, bàn thật không đổi, kiểm tra thế kết thúc |
| BF Native | PASS, 7 ply, bàn thật không đổi, kiểm tra thế kết thúc |
| Pikafish Web | PASS, 7 ply, tự lên lịch dựng, buộc nối từng nước khi fixture rút PV xuống 1 nước |
| BF Web | PASS, 7 ply, tự lên lịch dựng, thời gian 15 giây |

BF Web ở 1,5 giây trả partial, giao diện giữ đúng trạng thái chưa hoàn tất. BF Native có PV đầy đủ tại gốc nhưng hỏi lại sau nước đầu với mốc giảm cho kết quả draw; bộ dựng sử dụng tiếp PV cùng engine, chỉ hỏi thêm khi hết PV. Mọi nước trong PV vẫn được kiểm tra hợp lệ và trừ mốc trước khi thêm vào tuyến.

Đây là một tuyến dự kiến, trạng thái kết thúc không phải chứng minh mọi nhánh của đối phương. Không ghép PV của hai engine. Full đang chạy thì bộ dựng chờ; cache thường tạm dừng trong lượt dựng. Chưa kiểm tra cây Full lớn đồng thời bằng trình duyệt. Không dựng lại bản EXE đóng gói.
