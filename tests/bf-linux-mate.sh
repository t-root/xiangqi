#!/usr/bin/env bash
# Build Brute-force trên Linux (không đụng engine/ hay build-xiangqi.bat) và tìm mate cho một FEN.
#
#   bash tests/bf-linux-mate.sh "<FEN>" [budget=10] [giới hạn giờ, giây, mặc định không giới hạn]
#
# Ví dụ:
#   bash tests/bf-linux-mate.sh "9/3k5/9/9/9/9/9/4KC3/7c1/8C w - - 0 1" 10
#
# Biến môi trường:
#   BF_SRC   thư mục chứa main.cpp... (mặc định: engine/bruteforce-src/src cạnh script, hoặc ./src)
#   BF_WORK  thư mục build tạm (mặc định: ~/bf-run)
#   BF_OUT   file kết quả (mặc định: bf-result.txt cạnh script này)
#
# Kết quả: MATE (kèm số nước và dãy nước), NO MATE (đã quét cạn tới mức budget),
# hoặc PARTIAL (hết giờ trước khi quét xong, chưa kết luận được).
set -euo pipefail

FEN="${1:?Thiếu FEN. Dùng: bash $0 \"<FEN>\" [budget] [giây]}"
BUDGET="${2:-10}"
LIMIT="${3:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${BF_SRC:-}"
if [ -z "$SRC" ]; then
    for c in "$HERE/../engine/bruteforce-src/src" "$HERE/src" "$PWD/src"; do
        if [ -f "$c/main.cpp" ]; then SRC="$c"; break; fi
    done
fi
[ -f "${SRC:-/nonexistent}/main.cpp" ] || { echo "Không thấy mã nguồn BF. Đặt BF_SRC=<thư mục có main.cpp>." >&2; exit 2; }

WORK="${BF_WORK:-$HOME/bf-run}"
mkdir -p "$WORK"
OUT="${BF_OUT:-$HERE/bf-result.txt}"
BIN="$WORK/bruteforce"

echo "Build BF từ $SRC ..."
( cd "$SRC" && g++ -std=c++17 -O3 -pthread -o "$BIN" \
    main.cpp eval.cpp fen.cpp hash.cpp movegen.cpp positional.cpp repetition.cpp rules.cpp search.cpp )

# BF xử lý "go" bất đồng bộ và thoát khi stdin đóng, nên giữ stdin mở bằng FIFO
# tới khi thấy dòng "bestmove" rồi mới gửi "quit".
FIFO="$WORK/in.fifo"
rm -f "$FIFO"; mkfifo "$FIFO"
: > "$OUT"
"$BIN" < "$FIFO" > "$OUT" 2>&1 &
PID=$!
exec 3> "$FIFO"
cleanup() { exec 3>&- 2>/dev/null || true; kill "$PID" 2>/dev/null || true; rm -f "$FIFO"; }
trap cleanup EXIT

GO="go budget $BUDGET"
[ -n "$LIMIT" ] && GO="$GO movetime $((LIMIT * 1000))"
printf 'bruteforce\nisready\nposition fen %s\n%s\n' "$FEN" "$GO" >&3
echo "FEN: $FEN"
echo "Chạy: $GO (tiến độ in bên dưới; Ctrl+C để dừng)"

LAST=0
while ! grep -q '^bestmove' "$OUT"; do
    kill -0 "$PID" 2>/dev/null || break
    N=$(grep -c '^info depth' "$OUT" || true)
    if [ "$N" -gt "$LAST" ]; then grep '^info depth' "$OUT" | tail -n +"$((LAST + 1))"; LAST=$N; fi
    sleep 2
done
N=$(grep -c '^info depth' "$OUT" || true)
if [ "$N" -gt "$LAST" ]; then grep '^info depth' "$OUT" | tail -n +"$((LAST + 1))"; fi
printf 'quit\n' >&3 || true

echo
if grep -q 'score mate' "$OUT"; then
    echo "=== MATE ==="
    grep 'score mate' "$OUT" | tail -n 1
    grep '^bestmove' "$OUT" | tail -n 1
elif grep -q 'outcome partial' "$OUT"; then
    echo "=== PARTIAL: hết giờ trước khi quét xong mức $BUDGET, chưa kết luận ==="
else
    echo "=== NO MATE trong $BUDGET nước (đã quét cạn) ==="
fi
echo "Chi tiết: $OUT"
