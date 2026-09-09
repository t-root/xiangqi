$ErrorActionPreference = 'Stop'
$testRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $testRoot
$sourceRoot = Join-Path $projectRoot 'engine/bruteforce-src/src'
$outputRoot = Join-Path $testRoot 'binaries'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$compiler = (Get-Command g++ -ErrorAction Stop).Source
$sources = @('main.cpp','eval.cpp','fen.cpp','hash.cpp','movegen.cpp','positional.cpp','repetition.cpp','rules.cpp','search.cpp') |
    ForEach-Object { Join-Path $sourceRoot $_ }
# Historical diagnostic filename; rebuilt from today's core, not a frozen old binary.
& $compiler '-std=c++17' '-O3' '-flto=auto' '-pthread' '-static' '-static-libgcc' '-static-libstdc++' '-o' (Join-Path $outputRoot 'bruteforce.paralleltest.exe') @sources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$probeSources = @('movegen.cpp','rules.cpp','hash.cpp','fen.cpp') | ForEach-Object { Join-Path $sourceRoot $_ }
& $compiler '-std=c++17' '-O2' '-static' '-static-libgcc' '-static-libstdc++' '-I' $sourceRoot '-o' (Join-Path $outputRoot 'debug_root_streak.exe') (Join-Path $testRoot 'native/debug_root_streak.cpp') @probeSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'Diagnostic binaries rebuilt under tests/binaries.'
