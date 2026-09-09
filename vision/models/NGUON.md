# Nguồn các file model nhận diện ảnh

## board_layout_nano_v3.onnx

Đọc cả bàn cờ một lượt: nhận hình bàn cờ đã kéo phẳng (280x315) và chấm 90 ô, mỗi ô 16 lớp
(ô trống, vật lạ, 7 loại quân Đỏ, 7 loại quân Đen). Vì có sẵn màu quân và có chấm cả ô trống nên
nó thay được cả hai model dưới đây ở khâu đọc quân — hai model kia còn lại việc tìm bàn cờ nằm
đâu trong ảnh.

- Dự án gốc: https://github.com/TheOne1006/chinese-chess-recognition
- File lấy từ: https://huggingface.co/spaces/yolo12138/Chinese_Chess_Recognition
  đường dẫn `onnx/layout_recognition/nano_v3-0319.onnx`
- Giấy phép: MIT (khai trong README.md của Space)
- Kích thước: 31.101.356 byte

Cách dựng hình vào và thứ tự 16 lớp lấy từ `core/runonnx/full_classifier.py` và
`core/helper_4_kpt.py` của dự án gốc; app chép lại y nguyên trong `xiangqi-analyzer.html`
(xem `VISION_LAYOUT_*` và `drawBoardIntoLayoutInput`). Sửa lệch mấy con số đó là lệch hết ô.

Dự án gốc còn một model nữa dò 4 điểm góc bàn cờ (`onnx/pose/`, kiểu RTMPose) để kéo phẳng ảnh
chụp nghiêng. App chưa dùng: ảnh chụp màn hình vốn đã thẳng góc, và lưới suy từ model dò quân đã
đủ để biết bốn góc bàn. Ảnh chụp bàn cờ thật bằng điện thoại ở góc chéo là lúc cần tới nó.

## online_xiangqi_piece_detector.onnx, online_xiangqi_classifier.onnx

Hai model có sẵn từ trước trong dự án: một model dò vị trí mọi quân cờ (một lớp "quân cờ", kiểu
YOLO, hình vào 640x640), một model nhỏ đọc mặt chữ từng quân (7 loại, hình vào 64x64, không biết
màu quân). Vẫn dùng: model dò cho ra vị trí các quân để suy lưới 9x10, và cả hai làm đường dự
phòng khi thiếu file model đọc cả bàn.
