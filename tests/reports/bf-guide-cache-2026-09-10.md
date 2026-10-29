# BF: cache có kết luận nhưng thiếu nước hướng dẫn

Thế cờ dựng từ ảnh người dùng (không có lịch sử ván trong ảnh):

`3k5/7N1/3c5/4R4/8R/1N7/9/5K3/1C7/9 b - - 0 1`

Mốc còn lại: 2 nước; Đen đang thủ.

## Tái hiện và nguyên nhân

BF Native và BF Web đều cache `PROVEN_HOLD` cho gốc 2/2, không kèm bestmove.
Trước sửa, bước tìm nước thủ thử 17 nước bằng `go budgets red 2 black 2`.
Nước Đen đã thử không được trừ khỏi ngân sách nút con; các kết quả mate 2 khiến
hướng dẫn loại hết ứng viên. Giao diện chỉ báo đã chứng minh nhưng không có nước.

Ngoài ra, đọc cache bỏ sót kho riêng của engine khi kho chung không có mục tương ứng;
đồng bộ line vẫn cắt/xóa line trong chế độ BF đơn dù tính năng dựng lại đã tắt.

## Kết quả kiểm tra sau sửa

- `node tests/run.cjs`: toàn bộ bài kiểm tra đạt.
- Máy chủ riêng `tests/serve-composite-test.cjs`, trình duyệt:
  - `/__combo-test?line=1&engine=bruteforce&screenshot=1`: PASS.
  - `/__combo-test?line=1&engine=bruteforceweb&screenshot=1`: PASS.
- Cả hai dùng lại proof gốc, hỏi nút con 2/1 và trả nước Tướng `d9d8`.
- Xóa kho chung/proof trong fixture, giữ kho riêng engine: vẫn trả cùng nước, không gọi tìm kiếm.
- Hướng dẫn giữ nguyên line, vị trí xem và trạng thái line.
- Bài logic kiểm tra thêm cả hai bên, ngân sách bất đối xứng, miễn trừ ktc và hủy lượt dò.

Không khởi chạy launcher chính, không thay engine Native/WASM hoặc binary lịch sử.

## Làm rõ yêu cầu line

BF/BF Web vẫn dựng line lần đầu khi chốt phân tích (thắng hoặc hòa).
Chỉ tắt dựng lại sau mỗi nước; line ban đầu được giữ nguyên khi chơi tiếp.
Bản sửa cache và ngân sách nút con 2/1 được giữ lại.

Kiểm tra sau khi làm rõ: toàn bộ `node tests/run.cjs` PASS. Trên trình duyệt,
cả BF Native và BF Web đều PASS với `&initial=1` (line mate 7 ply) và
`&initial=1&draw=1` (line hòa 4 ply). Mỗi trường hợp dựng line ban đầu đúng một lần;
hai nước chơi tiếp giữ nguyên line và không gọi lại bộ dựng line.
