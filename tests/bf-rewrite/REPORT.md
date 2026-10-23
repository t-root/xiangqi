# Thử nghiệm tăng tốc Brute-force: bảng gợi ý nước và dùng lại mate của mức trước

Ngày chạy: 2026-10-23. Chỉ đo, không đổi engine chính (mã thử nghiệm lưu ở `experiment-hints.patch`,
đã gỡ khỏi `engine/bruteforce-src/src`).

## Dụng cụ

- `bfclient.cjs`: nói chuyện với `bruteforce.exe` qua stdin/stdout.
- `measure-levels.cjs`: số node và thời gian từng mức của `go budget N` trên một thế.
- `gen_positions.cpp`: sinh thế ngẫu nhiên hợp lệ (dựng: xem đầu file).
- `corpus-run.cjs` + `compare.cjs`: chạy hai bản trên cùng kho thế, so điểm/độ dài mate từng mức
  (phải giống hệt) và so tổng số node.
- `build.sh`: dựng bản thử vào `tests/binaries/`, không ghi đè engine chính.
- Kho thế: `positions-a.txt` (60 thế tàn cuộc 8–16 quân), `positions-b.txt` (40 thế 16–26 quân).

## Phần mức trước chiếm trong tổng số node (bản hiện tại, tất định)

| Thế | Tổng node | Node các mức trước mức cuối | Tối đa tiết kiệm nếu duyệt lại miễn phí |
|---|---|---|---|
| Tàn cuộc, `go budget 6` | 7.831.079 | 1.592.355 | 20,3% |
| Khai cuộc, `go budget 3` | 107.411 | 4.586 | 4,3% |

## Hướng 1 (bảng gợi ý nước không khóa ngân sách)

Bit 1 = dùng ở nút bên thủ, bit 2 = bên công, bit 3 (giá trị 4) = dùng lại mate chính xác của mức
ngân sách nhỏ hơn 1 trên cùng đường đi. Kết quả mọi mức giống hệt bản gốc (0 thế khác); chỉ số node:

| Chế độ | Kho A (budget 4) | Kho B (budget 3) |
|---|---|---|
| bên thủ (1) | 1,025 | — |
| bên công (2) | 1,000 | — |
| cả hai (3) | 1,024 | 1,029 |
| dùng lại mate mức trước (4) | 0,998 | 1,000 |
| cả ba (7) | — | 1,029 |

Trên một thế tàn cuộc cụ thể (`go budget 6`), chế độ bên thủ làm số node tăng 2,2 lần: nước thoát của
mức trước thường chỉ thoát nhờ hết ngân sách, sang mức sau nó bị bác bằng cả một cây con.

Kết luận: không có lợi ích đo được. Thời gian đo bằng ms dao động tới 2 lần giữa hai lần chạy cùng
một bản (lần chạy đầu chậm), nên chỉ dùng số node để so.
