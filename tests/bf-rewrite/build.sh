#!/usr/bin/env bash
# Dựng bản thử của Brute-force từ mã nguồn hiện tại vào tests/binaries/<tên>.exe — KHÔNG ghi đè engine
# chính trong engine/. Cờ build giống build-xiangqi.bat (-O3 -pthread -static).
# Dùng: bash tests/bf-rewrite/build.sh bruteforce.candidate
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="${1:-bruteforce.candidate}"
cd "$ROOT/engine/bruteforce-src/src"
g++ -std=c++17 -O3 -pthread -static -static-libgcc -static-libstdc++ \
  -o "$ROOT/tests/binaries/$NAME.exe" \
  main.cpp eval.cpp fen.cpp hash.cpp movegen.cpp positional.cpp repetition.cpp rules.cpp search.cpp \
  ${EXTRA_SOURCES:-}
echo "built tests/binaries/$NAME.exe"
