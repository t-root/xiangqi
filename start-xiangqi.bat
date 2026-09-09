@echo off
setlocal

REM Phong khi PATH thieu cac lenh he thong co ban (netstat, findstr, taskkill...)
set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"

set "ROOT=%~dp0"

echo === Xiangqi Analyzer launcher (chay tu source) ===
echo Thu muc: %ROOT%
echo.

REM server.js tu lo het: 2 bridge Pikafish/Brute-force (8899/8900), server tinh cho
REM xiangqi-analyzer.html (9999, thay the "python -m http.server"), tu do+tat cong dang
REM bi chiem, va tu mo trinh duyet khi san sang.
cd /d "%ROOT%engine"
node server.js
