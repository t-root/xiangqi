@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; $i = $t.LastIndexOf('#===PIKAFISH-PS==='); if ($i -lt 0) { Write-Host 'ERROR: missing embedded PowerShell builder.'; exit 1 }; & ([scriptblock]::Create($t.Substring($i))) -SrcDir '%~dp0engine\pikafish-src\src' -ProjectRoot '%~dp0' -Mode '%~1'"
set "BUILD_EXIT=%ERRORLEVEL%"
pause
exit /b %BUILD_EXIT%

setlocal enabledelayedexpansion


set "ROOT=%~dp0"
set "ENGINE_DIR=%ROOT%engine\"
set "DIST_DIR=%ROOT%dist"
set "PIKAFISH_SRC=%ENGINE_DIR%pikafish-src\src"
set "PIKAFISH_DEST=%ENGINE_DIR%pikafish"
set "BRUTEFORCE_SRC=%ENGINE_DIR%bruteforce-src\src"
set "BRUTEFORCE_DEST=%ENGINE_DIR%bruteforce"
set "BUILD_THREADS=%NUMBER_OF_PROCESSORS%"
if "%BUILD_THREADS%"=="" set "BUILD_THREADS=1"

set "ENGINES_ONLY="
if /i "%~1"=="engines" set "ENGINES_ONLY=1"

echo === Xiangqi Analyzer builder ===
echo Thu muc: %ROOT%
if defined ENGINES_ONLY echo Che do: CHI dung engine - bo qua buoc dong goi dist.
echo.

REM ==========================================================================
REM ==========================================================================
cd /d "%ENGINE_DIR%"

set "NODE_CMD="
"%SystemRoot%\System32\where.exe" /q node.exe
if not errorlevel 1 set "NODE_CMD=node"
if not defined NODE_CMD (
    echo ERROR: khong tim thay Node.js trong PATH. Cai Node.js roi chay lai file nay.
    pause
    exit /b 1
)

echo node_modules da co, bo qua npm ci.

echo.

REM ==========================================================================
REM ==========================================================================
if not exist "%PIKAFISH_SRC%\Makefile" (
    echo ERROR: Pikafish source Makefile not found at %PIKAFISH_SRC%.
    pause
    exit /b 1
)

if not exist "%BRUTEFORCE_SRC%\main.cpp" (
    echo ERROR: Brute-force source files not found at %BRUTEFORCE_SRC%.
    pause
    exit /b 1
)

cd /d "%PIKAFISH_SRC%"
echo Building Pikafish from %PIKAFISH_SRC%...

set "MAKE_CMD="
"%SystemRoot%\System32\where.exe" /q make.exe
if not errorlevel 1 set "MAKE_CMD=make"
if not defined MAKE_CMD "%SystemRoot%\System32\where.exe" /q mingw32-make.exe
if not defined MAKE_CMD if not errorlevel 1 set "MAKE_CMD=mingw32-make"

if defined MAKE_CMD goto :build_pikafish_with_make

echo make/mingw32-make not found. Building Pikafish with g++ directly...
set "PF_GPP="
"%SystemRoot%\System32\where.exe" /q g++.exe
if not errorlevel 1 set "PF_GPP=g++"
if not defined PF_GPP goto :pikafish_build_failed
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; $i = $t.LastIndexOf('#===PIKAFISH-PS==='); if ($i -lt 0) { Write-Host 'ERROR: khong thay doan PowerShell trong file bat.'; exit 1 }; & ([scriptblock]::Create($t.Substring($i))) -SrcDir '%PIKAFISH_SRC%' -Jobs %BUILD_THREADS%"
if errorlevel 1 goto :pikafish_build_failed
goto :pikafish_build_done

:build_pikafish_with_make
echo Using %MAKE_CMD% with the Pikafish Makefile...
%MAKE_CMD% -C "%PIKAFISH_SRC%" -j%BUILD_THREADS% ARCH=x86-64-bmi2 EXE=pikafish-bmi2.exe
if errorlevel 1 goto :pikafish_build_failed

:pikafish_build_done

if not exist "%PIKAFISH_SRC%\pikafish-bmi2.exe" (
    echo ERROR: Pikafish build finished but pikafish-bmi2.exe was not created.
    pause
    exit /b 1
)

goto :pikafish_build_continue

:pikafish_build_failed
echo.
echo *** PIKAFISH BUILD FAILED ***
pause
exit /b 1

:pikafish_build_continue

if not exist "%PIKAFISH_DEST%" mkdir "%PIKAFISH_DEST%"
call :deploy "%PIKAFISH_SRC%\pikafish-bmi2.exe" "%PIKAFISH_DEST%\pikafish-bmi2.exe" pikafish-bmi2.exe Pikafish
if errorlevel 1 exit /b 1

REM ==========================================================================
REM ==========================================================================
echo.
echo Pikafish Web duoc build tu ma nguon Pikafish trong may.
echo.

REM ==========================================================================
REM ==========================================================================
echo.
echo Building Brute-force from %BRUTEFORCE_SRC%...
cd /d "%BRUTEFORCE_SRC%"

set "BRUTEFORCE_SOURCES=main.cpp eval.cpp fen.cpp hash.cpp movegen.cpp positional.cpp repetition.cpp rules.cpp search.cpp"

set "GPP_CMD="
"%SystemRoot%\System32\where.exe" /q g++.exe
if not errorlevel 1 set "GPP_CMD=g++"
set "CL_CMD="
"%SystemRoot%\System32\where.exe" /q cl.exe
if not errorlevel 1 set "CL_CMD=cl"

if defined GPP_CMD (
    echo Using g++ to build Brute-force...
    rem Use a self-contained executable so it does not require MinGW DLLs at runtime.
    "%GPP_CMD%" -std=c++17 -O2 -pthread -static -static-libgcc -static-libstdc++ -o "%BRUTEFORCE_SRC%\bruteforce.exe" %BRUTEFORCE_SOURCES%
    if errorlevel 1 (
        echo.
        echo *** Brute-force build failed with g++ ***
        pause
        exit /b 1
    )
) else if defined CL_CMD (
    echo Using cl.exe to build Brute-force...
    "%CL_CMD%" /EHsc /std:c++17 /O2 /Fe"%BRUTEFORCE_SRC%\bruteforce.exe" %BRUTEFORCE_SOURCES%
    if errorlevel 1 (
        echo.
        echo *** Brute-force build failed with cl.exe ***
        pause
        exit /b 1
    )
) else (
    echo ERROR: Neither g++ nor cl.exe was found in PATH.
    echo Install MinGW/MSYS2 or use a Visual Studio Developer Command Prompt.
    pause
    exit /b 1
)

if not exist "%BRUTEFORCE_SRC%\bruteforce.exe" (
    echo ERROR: Brute-force build finished but bruteforce.exe was not created.
    pause
    exit /b 1
)

if not exist "%BRUTEFORCE_DEST%" mkdir "%BRUTEFORCE_DEST%"
call :deploy "%BRUTEFORCE_SRC%\bruteforce.exe" "%BRUTEFORCE_DEST%\bruteforce.exe" bruteforce.exe "Brute-force"
if errorlevel 1 exit /b 1

if defined ENGINES_ONLY (
    echo.
    echo === Dung engine xong ===
    echo Pikafish: %PIKAFISH_DEST%\pikafish-bmi2.exe
    echo Pikafish Web: %PIKAFISH_WEB_DEST%\
    echo Brute-force: %BRUTEFORCE_DEST%\bruteforce.exe
    echo Chay lai khong kem tham so "engines" de dong goi ra dist\XiangqiAnalyzer.exe.
    pause
    exit /b 0
)

REM ==========================================================================
REM ==========================================================================
echo.
call :cleandist
if errorlevel 1 exit /b 1
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

echo Dang dong goi XiangqiAnalyzer.exe (mat vai phut)...
cd /d "%ENGINE_DIR%"
call npm run build
if errorlevel 1 (
    echo.
    echo *** DONG GOI THAT BAI ***
    pause
    exit /b 1
)

if not exist "%DIST_DIR%\XiangqiAnalyzer.exe" (
    echo ERROR: dong goi xong nhung khong thay %DIST_DIR%\XiangqiAnalyzer.exe.
    pause
    exit /b 1
)

echo.
echo === Build completed successfully ===
echo Pikafish: %PIKAFISH_DEST%\pikafish-bmi2.exe
echo Pikafish Web: %PIKAFISH_WEB_DEST%\
echo Brute-force: %BRUTEFORCE_DEST%\bruteforce.exe
echo Ban dong goi: %DIST_DIR%\XiangqiAnalyzer.exe
pause
exit /b 0

:deploy
copy /Y %1 %2 >nul 2>&1
if not errorlevel 1 exit /b 0
echo %~4 dang chay, dong tien trinh %~3 roi chep lai...
"%WINDIR%\System32\taskkill.exe" /F /IM %~3 >nul 2>&1
"%WINDIR%\System32\timeout.exe" /T 1 /NOBREAK >nul 2>&1
copy /Y %1 %2 >nul 2>&1
if not errorlevel 1 exit /b 0
echo ERROR: khong chep duoc %~4 sang %2.
echo Dong cua so "node server.js" (va tab dang choi) roi chay lai file nay.
pause
exit /b 1

:cleandist
if not exist "%DIST_DIR%" exit /b 0
echo Don sach %DIST_DIR%...
rd /S /Q "%DIST_DIR%" >nul 2>&1
if not exist "%DIST_DIR%" exit /b 0
echo   Trong dist con file dang bi chiem giu, dong tien trinh lien quan roi xoa lai...
"%WINDIR%\System32\taskkill.exe" /F /IM XiangqiAnalyzer.exe >nul 2>&1
"%WINDIR%\System32\taskkill.exe" /F /IM pikafish-bmi2.exe >nul 2>&1
"%WINDIR%\System32\taskkill.exe" /F /IM bruteforce.exe >nul 2>&1
"%WINDIR%\System32\timeout.exe" /T 1 /NOBREAK >nul 2>&1
rd /S /Q "%DIST_DIR%" >nul 2>&1
if not exist "%DIST_DIR%" exit /b 0
echo ERROR: khong xoa sach duoc %DIST_DIR%.
echo Dong ban XiangqiAnalyzer.exe dang chay va cua so Explorer dang mo thu muc dist roi chay lai.
pause
exit /b 1

#===PIKAFISH-PS===
# ==========================================================================
#  Từ đây xuống là PowerShell, KHÔNG phải batch: dựng Pikafish bằng g++ trực tiếp, không cần make.
#  Phần batch ở trên cắt đoạn này ra rồi chạy, nên đừng xoá mốc #===PIKAFISH-PS=== ở dòng trên.
#
#  Biên dịch song song và bỏ qua file chưa đổi (so mốc sửa của .cpp và của mọi .h) vì gộp một lần
#  g++ cho cả 37 file mất ~8 phút; chia việc theo số lõi còn ~2 phút, và lần build sau chỉ dịch lại
#  phần vừa sửa.
# ==========================================================================
param(
    [string]$SrcDir,
    [string]$OutExe,
    [int]$Jobs = 0,
    [string]$Opt = '-O3',
    [switch]$Clean,
    [string]$ProjectRoot,
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

if (-not $SrcDir) { $SrcDir = Join-Path $PSScriptRoot 'pikafish-src\src' }
if (-not $OutExe) { $OutExe = Join-Path $SrcDir 'pikafish-bmi2.exe' }
if ($Jobs -le 0) {
    $Jobs = [int]$env:NUMBER_OF_PROCESSORS
    if ($Jobs -le 0) { $Jobs = 4 }
}

$gpp = Get-Command g++ -ErrorAction SilentlyContinue
if (-not $gpp) {
    Write-Host 'ERROR: khong tim thay g++ trong PATH.' -ForegroundColor Red
    exit 1
}

# Bộ cờ tương đương "make ARCH=x86-64-bmi2 COMP=mingw debug=no optimize=yes lto=yes":
#   -DIS_64BIT (mục 3.4), -msse -DUSE_PREFETCH, -msse3 -mpopcnt -DUSE_POPCNT, -mavx2 -mbmi
#   -DUSE_AVX2, -msse4.1 -DUSE_SSE41, -mssse3 -DUSE_SSSE3, -msse2 -DUSE_SSE2, -mbmi2 -DUSE_PEXT,
#   -fno-ipa-cp-clone (mục 3.1), -flto -flto-partition=one (mục 3.9).
# Phải giữ đúng bộ này: bản dựng thiếu LTO + thiếu file assembly của zstd tuy liên kết được nhưng
# hỏng ngầm — khoảng một nửa số lần chạy tắt ngay khi tạo thread pool với mã 0xC0000005.
# Thêm ngoài Makefile: -static* để server.js gọi được exe mà không cần DLL của MinGW trong PATH
# (thiếu DLL thì exe tắt ngay với mã 0xC0000135).
$commonFlags = @(
    '-std=c++17', $Opt, '-funroll-loops', '-DNDEBUG', '-fno-exceptions', '-w', '-fno-ipa-cp-clone',
    '-flto', '-flto-partition=one',
    '-m64', '-DIS_64BIT',
    '-msse', '-msse2', '-msse3', '-mssse3', '-msse4.1', '-mpopcnt', '-mavx2', '-mbmi', '-mbmi2',
    '-DUSE_PREFETCH', '-DUSE_POPCNT', '-DUSE_SSE2', '-DUSE_SSSE3', '-DUSE_SSE41', '-DUSE_AVX2',
    '-DUSE_PEXT'
)
$linkFlags = $commonFlags + @('-static', '-static-libgcc', '-static-libstdc++')
$linkLibs = @('-lpthread')

# Bỏ universal/ (mấy file entry_*.cpp của bản "universal binary", mỗi file một entry point riêng) và
# temp_builds/ — y như phần prune trong biến SRCS của Makefile. Lấy cả .S: file assembly
# external/decompress/huf_decompress_amd64.S là nhánh giải nén nhanh của zstd, thiếu nó thì liên kết
# báo thiếu HUF_decompress4X*_..._fast_asm_loop.
$sources = Get-ChildItem -Recurse -Path $SrcDir -Include *.cpp, *.S |
    Where-Object { $_.FullName -notmatch '\\(universal|temp_builds)\\' } |
    Sort-Object FullName
if (-not $sources) {
    Write-Host "ERROR: khong thay file .cpp nao trong $SrcDir." -ForegroundColor Red
    exit 1
}

$objDir = Join-Path $SrcDir 'obj-bmi2'
if ($Clean -and (Test-Path $objDir)) { Remove-Item -Recurse -Force $objDir }
if (-not (Test-Path $objDir)) { New-Item -ItemType Directory -Path $objDir | Out-Null }

# Sửa một header là có thể ảnh hưởng bất kỳ file nào, mà dò #include thật thì quá rườm rà: lấy mốc
# sửa MỚI NHẤT của mọi .h làm mốc chung. Đổi cờ biên dịch cũng phải dịch lại hết, nên ghi cờ vào
# một file mốc và coi nó như một header.
$stampFile = Join-Path $objDir 'flags.stamp'
$flagsText = ($commonFlags + $linkFlags) -join ' '
if (-not (Test-Path $stampFile) -or (Get-Content $stampFile -Raw) -ne $flagsText) {
    Set-Content -Path $stampFile -Value $flagsText -NoNewline
}
$newestHeader = (Get-ChildItem -Recurse -Path $SrcDir -Include *.h, *.hpp |
    Where-Object { $_.FullName -notmatch '\\(universal|temp_builds|obj-bmi2)\\' } |
    Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
$stampTime = (Get-Item $stampFile).LastWriteTimeUtc
if ($stampTime -gt $newestHeader) { $newestHeader = $stampTime }

# Tên .o phải phẳng nhưng không được đụng nhau: nnue/network.cpp và src/network.cpp cùng tên file.
function Get-ObjPath($file) {
    $rel = $file.FullName.Substring($SrcDir.Length).TrimStart('\')
    return Join-Path $objDir ($rel -replace '[\\/]', '_' -replace '\.(cpp|S)$', '.o')
}

$todo = @()
$objs = @()
foreach ($s in $sources) {
    $obj = Get-ObjPath $s
    $objs += $obj
    if (-not (Test-Path $obj)) { $todo += , @($s, $obj); continue }
    $objTime = (Get-Item $obj).LastWriteTimeUtc
    if ($objTime -lt $s.LastWriteTimeUtc -or $objTime -lt $newestHeader) { $todo += , @($s, $obj) }
}

Write-Host "Pikafish: $($sources.Count) file nguon, can dich lai $($todo.Count), $Jobs viec song song."

if ($todo.Count -gt 0) {
    # Ba biến trạng thái dưới đây PHẢI là loại sửa-tại-chỗ (List/hashtable) và Wait-Slot chỉ được
    # gọi .Add()/.Remove()/tăng field, TUYỆT ĐỐI không gán lại biến: đoạn này chạy bằng
    # [scriptblock]::Create nên "$script:running = ..." trong hàm tạo ra MỘT BIẾN KHÁC, không phải
    # $running của scope này — vòng while đọc $running.Count sẽ mãi không thấy giảm và treo cứng.
    $running = New-Object 'System.Collections.Generic.List[object]'
    $failed = New-Object 'System.Collections.Generic.List[string]'
    $state = @{ Done = 0 }

    # Đợi tới khi số việc đang chạy dưới $limit, thu kết quả các việc đã xong.
    # Chụp danh sách bằng .ToArray() (KHÔNG phải @($running)): vòng lặp có gọi .Remove() nên phải
    # duyệt trên bản chụp, mà @() bọc một List lấy từ scope ngoài thì chết ngay bằng
    # "ArgumentException: Argument types do not match" — .ToArray() vừa chụp đúng vừa không lỗi.
    function Wait-Slot([int]$limit) {
        while ($running.Count -ge $limit) {
            Start-Sleep -Milliseconds 120
            foreach ($job in $running.ToArray()) {
                if (-not $job.Proc.HasExited) { continue }
                [void]$running.Remove($job)
                $state.Done++
                $log = [string]''
                if (Test-Path $job.Log) {
                    $log = [string](Get-Content $job.Log -Raw)
                    # Tiến trình vừa thoát có thể chưa nhả xong handle file log, xoá không được
                    # thì bỏ qua — log nằm trong obj-bmi2/ nên không lẫn vào đâu.
                    Remove-Item $job.Log -Force -ErrorAction SilentlyContinue
                }
                if ($job.Proc.ExitCode -ne 0) {
                    $failed.Add("$($job.Name)`n$log")
                    Write-Host "  [$($state.Done)/$($todo.Count)] LOI $($job.Name)" -ForegroundColor Red
                } else {
                    Write-Host "  [$($state.Done)/$($todo.Count)] $($job.Name)"
                    if ($log -and $log.Trim()) { Write-Host $log }
                }
            }
        }
    }

    foreach ($item in $todo) {
        $src = $item[0]; $obj = $item[1]
        Wait-Slot $Jobs
        $log = "$obj.log"
        $proc = Start-Process -FilePath $gpp.Source -PassThru -NoNewWindow -RedirectStandardError $log `
            -ArgumentList ($commonFlags + @('-c', $src.FullName, '-o', $obj))
        # Đọc .Handle ngay để PowerShell giữ handle tiến trình lại; không làm vậy thì .ExitCode sau
        # này luôn rỗng, mà rỗng thì so với 0 sẽ ra "khác 0" và mọi file đều bị báo lỗi oan.
        $null = $proc.Handle
        $running.Add([pscustomobject]@{ Proc = $proc; Name = $src.Name; Log = $log })
    }
    Wait-Slot 1

    if ($failed.Count -gt 0) {
        Write-Host ''
        Write-Host "*** Bien dich loi ($($failed.Count) file) ***" -ForegroundColor Red
        foreach ($msg in $failed.ToArray()) { Write-Host $msg }
        exit 1
    }
}

Write-Host 'Dang lien ket...'
# Liên kết ra file tạm rồi mới đổi tên: nếu exe đích đang bị một tiến trình giữ (server.js còn chạy)
# thì cũng không làm hỏng bản cũ, và báo được đúng nguyên nhân.
$tmpExe = Join-Path $objDir 'pikafish-link.exe'
& $gpp.Source @linkFlags '-o' $tmpExe @objs @linkLibs
if ($LASTEXITCODE -ne 0) {
    Write-Host '*** Lien ket loi ***' -ForegroundColor Red
    exit 1
}

try {
    Copy-Item -Force $tmpExe $OutExe
} catch {
    Write-Host "ERROR: khong ghi duoc $OutExe (co the dang bi chiem giu)." -ForegroundColor Red
    Write-Host 'Dong node server.js / tat tien trinh pikafish roi chay lai.' -ForegroundColor Red
    exit 1
}

Write-Host "Xong: $OutExe"

if (-not $ProjectRoot) {
    exit 0
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$engineDir = Join-Path $ProjectRoot 'engine'
$pikaDest = Join-Path $engineDir 'pikafish'
$pikaDestExe = Join-Path $pikaDest 'pikafish-bmi2.exe'
New-Item -ItemType Directory -Force -Path $pikaDest | Out-Null
Copy-Item -LiteralPath $OutExe -Destination $pikaDestExe -Force

# Rebuild the browser engine on every full build so it always matches Pikafish Native.
Write-Host 'Dang build Pikafish Web tu cung ma nguon Pikafish...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'build-pikafish-web.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Brute-force Web is the browser build of the exact native Brute-force core.
# Rebuild it every full engine build so the .wasm cannot drift from bruteforce.exe.
Write-Host 'Dang build Brute-force Web tu cung ma nguon Brute-force...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'build-bruteforce-web.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$bruteforceSrc = Join-Path $engineDir 'bruteforce-src\src'
$bruteforceDest = Join-Path $engineDir 'bruteforce'
$bruteforceOut = Join-Path $bruteforceSrc 'bruteforce.exe'
$bruteforceSources = @('main.cpp', 'eval.cpp', 'fen.cpp', 'hash.cpp', 'movegen.cpp', 'positional.cpp', 'repetition.cpp', 'rules.cpp', 'search.cpp')
Write-Host 'Dang dung Brute-force...'
Push-Location $bruteforceSrc
try {
    & $gpp.Source '-std=c++17' '-O2' '-pthread' '-static' '-static-libgcc' '-static-libstdc++' '-o' $bruteforceOut @bruteforceSources
    if ($LASTEXITCODE -ne 0) { exit 1 }
} finally {
    Pop-Location
}
New-Item -ItemType Directory -Force -Path $bruteforceDest | Out-Null
Copy-Item -LiteralPath $bruteforceOut -Destination (Join-Path $bruteforceDest 'bruteforce.exe') -Force

if ($Mode -ieq 'engines') {
    Write-Host '=== Dung engine xong ==='
    exit 0
}

$nodeModules = Join-Path $engineDir 'node_modules'
$pkgCmd = Join-Path $nodeModules '.bin\pkg.cmd'
if (-not (Test-Path -LiteralPath $nodeModules) -or -not (Test-Path -LiteralPath $pkgCmd)) {
    Push-Location $engineDir
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { exit 1 }
    } finally {
        Pop-Location
    }
}

$distDir = Join-Path $ProjectRoot 'dist'
if (Test-Path -LiteralPath $distDir) { Remove-Item -LiteralPath $distDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Write-Host 'Dang dong goi XiangqiAnalyzer.exe...'
Push-Location $engineDir
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit 1 }
} finally {
    Pop-Location
}

$releaseExe = Join-Path $distDir 'XiangqiAnalyzer.exe'
if (-not (Test-Path -LiteralPath $releaseExe)) {
    Write-Host "ERROR: khong thay $releaseExe" -ForegroundColor Red
    exit 1
}
Write-Host "=== Build xong: $releaseExe ===" -ForegroundColor Green
exit 0
