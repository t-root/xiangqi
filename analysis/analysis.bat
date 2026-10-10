@echo off
setlocal
cd /d "%~dp0"
title Analysis - Brute-force

rem Bo sung PATH phong khi duoc mo tu moi truong thieu System32/Node.
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%AppData%\npm;C:\MinGW\bin"
for /d %%D in (C:\gcc-*) do set "PATH=%PATH%;%%D\bin"
chcp 65001 >nul

where node >nul 2>&1
if errorlevel 1 (
    echo Khong tim thay Node.js. Hay cai Node.js hoac them no vao PATH.
    pause
    exit /b 1
)

rem Dung engine neu chua co bin\bfanalysis.exe (can g++).
if not exist "bin\bfanalysis.exe" (
    echo Dang dung engine vao bin\bfanalysis.exe ...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
    if errorlevel 1 (
        echo Dung engine that bai.
        pause
        exit /b 1
    )
)

rem Neu co ban engine moi dung do (bin\bfanalysis.new.exe) thi thay vao khi khong con ai dung file cu.
if exist "bin\bfanalysis.new.exe" move /y "bin\bfanalysis.new.exe" "bin\bfanalysis.exe" >nul 2>&1

node "%~dp0analysis.cjs"
if errorlevel 1 pause
exit /b %errorlevel%
