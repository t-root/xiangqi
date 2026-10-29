# Kiểm tra lịch sử đầu vào — 2026-09-10

## Kết quả

- `node tests/run.cjs`: PASS toàn bộ bộ kiểm thử, bao gồm 8 nhóm lịch sử mới.
- Trình duyệt, `/__combo-test?history=1&mode=nativecombo`: PASS. Ghi nhận lệnh thực tế vào Pikafish và Brute-force, chạy đơn/phối hợp, ăn quân, hoàn tác, can thiệp biến thể và mở lại hướng dẫn.
- Trình duyệt, `/__combo-test?history=1&mode=webcombo`: PASS với hai engine WASM thật và cùng các thao tác trên.
- Trình duyệt, `/__combo-test?cache=1&engine=pikafishweb`: PASS, 20 nhánh được gửi, sâu nhất 6. Bài này xác nhận điều phối và tiến độ, không khẳng định cả 20 nhánh đều thắng.
- Chỉ chạy binary hiện tại trong `engine/`; dùng máy chủ thử `tests/serve-composite-test.cjs`.

## Thay đổi

Lịch sử gửi engine giữ tất cả nước từ thế nhập/đầu ván của nhánh đang chọn, không xóa sau ăn quân. Các nhánh giả định nối thêm nước trên bản sao. Hoàn tác/đi tới, checkpoint phân tích và can thiệp biến thể giữ nguồn lịch sử. Các lượt đánh giá, dựng tuyến và dò hòa dùng bộ tạo lệnh chung. Lịch sử không khớp bị từ chối thay vì âm thầm gửi FEN đơn lẻ. Bộ đếm chiếu của nền Pikafish tách khỏi bộ đếm tại bàn hiện tại dùng kiểm tra nước trên Web.

## Hiệu suất

Xem `history-performance.json`, tái lập bằng `node tests/history-performance.cjs`.
Đo 150 lần mỗi độ dài bằng hàm thật trong Node VM, loại thời gian khởi tạo; thế ít quân, chu kỳ Xe tổng hợp để thử lịch sử dài.

| Lượt đi trong lịch sử | Trung vị chuẩn bị đầu vào | Kích thước lệnh |
|---:|---:|---:|
| 4 | 0,567 ms | 75 byte |
| 40 | 1,500 ms | 255 byte |
| 120 | 3,518 ms | 655 byte |
| 240 | 6,783 ms | 1.255 byte |
| 500 | 10,639 ms | 2.555 byte |

Một lượt là một bên đi một nước. Đây là tổng thời gian tạo trạng thái và lệnh, không phải chênh lệch so với bản cũ. Chưa gồm truyền lệnh, phát lại bên engine, tìm kiếm, hiển thị hay đo RAM. Lịch sử tổng hợp dài có thể vượt các điều kiện kết thúc ván thông thường.

Chi phí tăng gần theo độ dài lịch sử; với lượt tìm nước kéo dài vài giây, phần chuẩn bị đã đo là nhỏ. Cache nhiều nhánh phải sao chép/kiểm tra nhiều lần và giữ nhiều lịch sử, nên CPU/RAM tăng; khóa cache phân biệt lịch sử cũng có thể giảm tái sử dụng giữa các đường đến cùng bàn. Chưa đo tổng thời gian Full cache hoặc toàn ván, không suy ra phần trăm chậm đi chung từ bài đo này.
