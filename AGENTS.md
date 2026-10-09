# Kiểm thử dự án

Toàn bộ test và tài liệu kiểm thử nằm trong **`tests/`**. Đọc **`tests/README.md`** trước khi sửa hoặc kiểm tra engine, phối hợp Native/Web, cache hay cầu nối.

- Lệnh kiểm tra chính từ thư mục gốc: `node tests/run.cjs`.
- Hoặc chạy `npm test` trong `engine/`.
- Test mới, fixture, báo cáo và file chạy chẩn đoán phải để trong `tests/`, không rải vào mã nguồn.
- Dùng máy chủ thử riêng trong `tests/` khi kiểm tra trình duyệt; tránh khởi chạy launcher chính chỉ để test vì nó có thao tác cổng/firewall.
- Không dùng binary lịch sử trong `tests/binaries/` thay cho engine chạy chính.
