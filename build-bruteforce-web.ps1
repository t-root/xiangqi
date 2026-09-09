param(
    [string]$EmsdkRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'engine\bruteforce-src\src'
$outputRoot = Join-Path $projectRoot 'bruteforce-web'

$candidates = @($EmsdkRoot, $env:EMSDK, (Join-Path $projectRoot 'emsdk'),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'emsdk' })) | Where-Object { $_ }
if (-not $candidates.Count) {
    $empp = Get-Command em++ -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($empp -and $empp.Source) { $candidates += Split-Path -Parent (Split-Path -Parent $empp.Source) }
}
$EmsdkRoot = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'upstream\emscripten\em++.py') } | Select-Object -First 1
if (-not $EmsdkRoot) { throw 'Emscripten was not found. Set EMSDK or pass -EmsdkRoot.' }

$python = Get-ChildItem -LiteralPath (Join-Path $EmsdkRoot 'python') -Recurse -File -Filter 'python.exe' |
    Select-Object -First 1 -ExpandProperty FullName
$empp = Join-Path $EmsdkRoot 'upstream\emscripten\em++.py'
if (-not $python) { throw 'Emscripten bundled Python was not found.' }

$env:EMSDK_PYTHON = $python
$env:PYTHON = $python
$env:Path = "$(Split-Path -Parent $python);$env:Path"
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$sources = @('main.cpp','eval.cpp','fen.cpp','hash.cpp','movegen.cpp','positional.cpp','repetition.cpp','rules.cpp','search.cpp') |
    ForEach-Object { Join-Path $sourceRoot $_ }
$arguments = @(
    $empp, $sources,
    '-std=c++17', '-O3', '-DNDEBUG', '-pthread', '-fexceptions', '-sINITIAL_MEMORY=64MB', '-sALLOW_MEMORY_GROWTH',
    '-sSTACK_SIZE=3MB', '-sPTHREAD_POOL_SIZE=1', '-sMODULARIZE=1', '-sEXPORT_NAME=BruteForceWeb',
    '-sENVIRONMENT=web,worker', '-sNO_EXIT_RUNTIME=1',
    "-sEXPORTED_FUNCTIONS=['_bruteforce_command','_malloc','_free']",
    "-sEXPORTED_RUNTIME_METHODS=['stringToUTF8','lengthBytesUTF8']",
    '-o', (Join-Path $outputRoot 'bruteforce.js')
)

& $python @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-ChildItem -LiteralPath $outputRoot -File | Select-Object Name, Length
