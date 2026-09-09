param(
    [string]$EmsdkRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'engine\pikafish-src\src'
$outputRoot = Join-Path $projectRoot 'pikafish-web'

# Do not bind this build to one Windows user. Prefer the argument, EMSDK, a local emsdk,
# then an em++ command already available in PATH.
$emsdkCandidates = @(@(
    $EmsdkRoot,
    $env:EMSDK,
    (Join-Path $projectRoot 'emsdk'),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'emsdk' })
) | Where-Object { $_ })

if (-not $emsdkCandidates.Count) {
    $emppCommand = Get-Command em++ -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($emppCommand -and $emppCommand.Source) {
        $emsdkCandidates += @(Split-Path -Parent (Split-Path -Parent $emppCommand.Source))
    }
}

$EmsdkRoot = $emsdkCandidates |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'upstream\emscripten\em++.py') } |
    Select-Object -First 1

if (-not $EmsdkRoot) {
    throw 'Emscripten was not found. Install emsdk, set EMSDK, or pass -EmsdkRoot.'
}

$EmsdkRoot = (Resolve-Path -LiteralPath $EmsdkRoot).Path
$python = Get-ChildItem -LiteralPath (Join-Path $EmsdkRoot 'python') -Recurse -File -Filter 'python.exe' |
    Select-Object -First 1 -ExpandProperty FullName
$empp = Join-Path $EmsdkRoot 'upstream\emscripten\em++.py'
$nnue = (Join-Path $projectRoot 'engine\pikafish\pikafish.nnue') + '@/pikafish.nnue'

if (-not $python -or !(Test-Path -LiteralPath $empp)) {
    throw 'Emscripten was found but its bundled Python is missing. Run emsdk install/activate, then retry.'
}

# em++ launches file_packager.exe in a child process; force that child to use the Python bundled
# with this emsdk instead of an older system Python found first in PATH.
$env:EMSDK_PYTHON = $python
$env:PYTHON = $python
$env:Path = "$(Split-Path -Parent $python);$env:Path"

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$sources = Get-ChildItem -LiteralPath $sourceRoot -Recurse -Filter '*.cpp' |
    Where-Object { $_.FullName -notmatch '\\universal\\' } |
    ForEach-Object { $_.FullName }

$arguments = @(
    $empp, $sources,
    '-std=c++17', '-O3', '-DNDEBUG', '-DIS_64BIT', '-DARCH=wasm32',
    '-DUSE_POPCNT', '-DUSE_SLOPPY_ATOMICS', '-DUSE_SSE2', '-DUSE_SSSE3', '-DUSE_SSE41',
    '-fno-exceptions', '-pthread', '-msimd128', '-msse', '-msse2', '-mssse3', '-msse4.1',
    '-sINITIAL_MEMORY=64MB', '-sALLOW_MEMORY_GROWTH', '-sSTACK_SIZE=3MB', '-sPTHREAD_POOL_SIZE=2',
    '-sMODULARIZE=1', '-sEXPORT_NAME=Pikafish', '-sENVIRONMENT=web,worker', '-sFORCE_FILESYSTEM=1',
    "-sEXPORTED_FUNCTIONS=['_pikafish_command','_malloc','_free']",
    "-sEXPORTED_RUNTIME_METHODS=['stringToUTF8','lengthBytesUTF8']",
    '--preload-file', $nnue, '-o', (Join-Path $outputRoot 'pikafish.js')
)

& $python @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Get-ChildItem -LiteralPath $outputRoot -File | Select-Object Name, Length
