# Dựng bin/bfanalysis.exe từ src/ (chỉ cần g++). Không đụng tới engine chính của dự án.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$gpp = (Get-Command g++ -ErrorAction Stop).Source
$files = @('main.cpp','eval.cpp','fen.cpp','hash.cpp','movegen.cpp','positional.cpp','repetition.cpp','rules.cpp','search.cpp') |
    ForEach-Object { Join-Path $src $_ }
& $gpp '-std=c++17' '-O3' '-pthread' '-static' '-static-libgcc' '-static-libstdc++' '-o' (Join-Path $bin 'bfanalysis.exe') @files
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "Đã dựng $(Join-Path $bin 'bfanalysis.exe')"
