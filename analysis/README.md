# analysis — phân tích thế cờ bằng Brute-force, dừng được và chạy tiếp được

Thư mục **độc lập** với mã chính (`engine/`, `xiangqi-analyzer.html`): có bản sao riêng của engine Brute-force trong `src/`, tự dựng.
Không sửa và không phụ thuộc gì bên ngoài thư mục này.

Mục tiêu: nhập một FEN, engine tìm **chiếu bí ép** (mate); có thể **dừng** (Ctrl+C, hết giờ, tắt máy) và **chạy tiếp** sau đó —
mọi tiến độ được lưu ra đĩa và dùng lại ở lần chạy kế tiếp.

## Dùng: bấm đúp `analysis.bat`

Menu điều khiển hoàn toàn bằng phím (↑/↓ chọn, Enter xác nhận, Esc quay lại, q thoát; số 1–9 chọn nhanh).
Lần đầu nếu chưa có engine, `analysis.bat` tự dựng `bin/bfanalysis.exe` (cần g++).

1. **Phân tích thế MỚI** — dán FEN (chuột phải hoặc Ctrl+V), chỉnh hoặc để mặc định số nước tối đa, giới hạn thời gian, số luồng, luật chiếu rồi bắt đầu.
   Thế đã có tiến độ thì báo "sẽ TIẾP TỤC".
2. **Các thế đã phân tích trước đó** — chia ba nhóm: *Đã có mate*, *Chưa có mate (đang dở)*, *Đã quét trọn, không có mate*.
   Chọn một thế để xem kết quả, tiếp tục, tiếp tục có giới hạn thời gian, tăng số nước tối đa, dò lại từ đầu, xem lịch sử lưu hoặc xoá.

Trong lúc phân tích có **một dòng tiến độ tự cập nhật mỗi giây** (mức đang dò, tổng số nút, nút/giây, thời gian đã dò; hiện "đang lưu tiến độ…" khi ghi đĩa) nên màn hình không bị đứng. Nhấn **Ctrl+C** để dừng và lưu; menu vẫn mở, lần sau chọn lại thế đó là chạy tiếp.
Mặc định: luật chiếu "Phân Tích" (bên đi sau chỉ được chiếu liên tiếp 2 lần bằng một quân), số luồng = một nửa số luồng của máy, số nước tối đa 15.

Dòng lệnh không tương tác (cho script): `node analysis.cjs --help` (chạy `node analysis.cjs` không tham số là mở menu).

## Cái gì được lưu và "tiếp tục" nghĩa là gì

Mỗi **bài toán** = thế cờ + bên đi + luật chiếu liên tục + ktc. Mỗi bài toán một tệp đặt tên **bằng chính FEN** (dấu `/` không được dùng trong tên tệp nên hiện là `_`), cùng một tệp lịch sử `.log`:

```
data/9_3k5_9_9_9_9_9_4KC3_7c1_8C w - - 0 1.bfck            (luật mặc định "Phân Tích")
data/9_3k5_9_9_9_9_9_4KC3_7c1_8C w - - 0 1 [both-3].bfck   (luật khác mặc định: có đuôi [bên bị giới hạn-số lần])
```

Luật khác nhau thì tên tệp khác nhau nên không dùng nhầm tiến độ của nhau. Tệp cũ đặt tên bằng mã băm sẽ tự được đổi sang tên theo FEN lần đầu mở. Trong tệp có:

1. mức budget đã quét **trọn vẹn** (không dò lại các mức này);
2. bảng chuyển vị + witness của mức đang dở (dò lại mức đó tận dụng phần đã chứng minh);
3. kết quả mate nếu đã tìm thấy (chạy lại trả ngay);
4. tổng thời gian/nút đã dò qua mọi lần chạy.

Giới hạn: ngăn xếp đệ quy đang dò dở **không** lưu được, nên tiếp tục là "khởi động ấm" — mức dở đi xuống lại từ gốc nhưng nhanh hơn nhiều nhờ bảng băm đã nạp.
Bảng băm có kích thước cố định và ghi đè khi đầy (cột "Bảng đầy" trong lịch sử gần 100% nghĩa là kết quả cũ đang bị ghi đè); tăng `--hash-bits` (24 = 256 MB mỗi luồng) để giữ nhiều hơn.
Đổi số luồng giữa các lần chạy vẫn dùng được tiến độ cũ. Tệp hỏng/cụt/sai phiên bản bị bỏ qua an toàn.

## SQLite và sách đáp án (hướng dẫn chơi thắng)

Ngoài các tệp `.bfck`, thư mục `data/` có **`analysis.db`** (SQLite, cần Node >= 22.5, tự bỏ qua nếu thiếu). Nó là bản sao **truy vấn được** của tiến độ:

| Bảng | Nội dung |
|---|---|
| `positions` | mỗi thế một dòng: FEN, luật, mức đã quét, kết quả mate + tuyến, thời gian đã dò (tự đồng bộ từ các tệp `.bfck` mỗi lần mở danh sách) |
| `history` | mỗi lần lưu một dòng (giờ, mức, nút, kích thước, thời gian lưu, độ đầy bảng băm) |
| `book` | **sách đáp án**: với mỗi thế trên cây chứng minh, nước thắng và số nước còn lại tới chiếu bí |

Bảng chuyển vị ~300 MB **vẫn ở tệp `.bfck`** (chỉ cần nạp lại để dò tiếp; ghi hàng triệu dòng vào SQLite sẽ chậm hơn nhiều).

**Sách đáp án**: với thế đã có mate, menu → chọn thế → *Xây / cập nhật sách đáp án* (hoặc `node analysis.cjs --fen "..." --book`). Engine đi lại cây chứng minh: ở mỗi thế
của bên tấn công tìm nước thắng ngắn nhất (nhanh nhờ bảng băm đã lưu), rồi xét **mọi** nước đáp hợp lệ của bên thủ. Ví dụ mate 7 ra 1.256 thế trong vài giây; mate 8 khoảng 441 thế.
Khóa tra cứu là FEN (kèm trạng thái chiếu liên tục). **Hướng dẫn chơi**: menu → chọn thế → *Hướng dẫn chơi theo sách đáp án*: hiện nước thắng, bạn nhập nước đáp của đối phương (dạng `h2e2`), nhận nước kế tiếp.
Tra nhanh bằng dòng lệnh: `node analysis.cjs --guide --fen "<FEN hiện tại>"`. Thế không có trong sách = nước đối phương sai luật hoặc ngoài cây chứng minh.

## Khi tiến trình bị tắt, máy ngủ hoặc mất điện

| Sự cố | Điều xảy ra |
|---|---|
| Xong một mức quét / **tìm thấy mate** | Lưu **ngay lập tức**. |
| Đang dò dở một mức rất lâu | Tự lưu mỗi **10 phút (600 giây)** (tự giãn ra nếu một lần lưu tốn nhiều giây vì tệp lớn). |
| Ctrl+C, hết giờ | Dừng, lưu rồi thoát. |
| Đóng cửa sổ, đăng xuất, tắt máy từ hệ điều hành, `kill`/SIGTERM | Engine dừng, **đợi lưu xong** (tối đa 30 giây) rồi mới thoát. |
| Bị giết cứng (End task, `kill -9`) hoặc **mất điện** | Còn bản lưu gần nhất. Tệp luôn nguyên vẹn: ghi ra tệp tạm, ép xuống đĩa, rồi mới đổi tên thay tệp cũ. |
| Máy ngủ (connected standby) | Engine **giữ máy không tự ngủ** khi đang phân tích (màn hình vẫn tắt được). Thời gian "đã dò" chỉ tính lúc máy thực sự chạy, không tính phần ngủ. |

Tuyến (PV) đầy đủ cần witness (mặc định 500000 mỗi luồng). Thế rất sâu có thể thiếu → báo "tuyến chưa đầy đủ" (mate và nước đầu vẫn đúng);
khi đó chạy lại với `--new --witness-limit 3000000` bằng `node analysis.cjs`.

## Đóng gói thành một tệp exe (chạy ở máy khác)

`powershell -ExecutionPolicy Bypass -File build-exe.ps1` → **`dist/analysis.exe`** (~97 MB): gói sẵn Node, `analysis.cjs` và engine, nên máy đích **không cần cài Node hay g++**.
Chép riêng `analysis.exe` sang máy khác rồi bấm đúp (menu) hoặc chạy `analysis.exe --fen "..."`. Lần đầu nó tự bung engine ra `bin/` và lưu tiến độ ở `data/` **cạnh exe**.
Máy dựng cần Node >= 22.5, g++ (nếu chưa có `bin/bfanalysis.exe`) và mạng (tải `postject`). `dist/analysis.exe` được đưa vào git (~97 MB, mỗi lần dựng lại và commit sẽ làm repo nặng thêm ~97 MB; nên cân nhắc dùng GitHub Releases).

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `analysis.bat` | bấm đúp để mở menu (tự dựng engine nếu chưa có) |
| `analysis.cjs` | **một tệp duy nhất**: menu điều khiển bằng phím + phân tích dòng lệnh + đọc danh sách tiến độ |
| `src/` | bản sao engine Brute-force (đa luồng: chia nước gốc theo quân, kho chung, lấy trộm việc, dùng chung alpha) + lưu/nạp tiến độ |
| `build.ps1` | dựng `bin/bfanalysis.exe` |
| `build-exe.ps1` | đóng gói tất cả thành `dist/analysis.exe` |
| `data/`, `bin/` | tiến độ đã lưu (`.bfck`, `.log`, `analysis.db`) và engine đã dựng (không đưa vào git) |

Kiểm thử: `node --test test/fens.test.cjs` (FEN trong `test/fens.json`; thế có `mate` được chạy lại bằng engine nếu có `bin/bfanalysis.exe`).
