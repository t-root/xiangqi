param(
    [string]$EmsdkRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'engine\bruteforce-src\src'
$outputRoot = Join-Path $projectRoot 'bruteforce-web'
$emscriptenTempRoot = Join-Path $projectRoot '.build\emscripten-temp'

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
New-Item -ItemType Directory -Force -Path $emscriptenTempRoot | Out-Null
# Keep Emscripten's temporary object files in the project instead of the user's
# system temp folder, which can be unavailable or briefly locked during builds.
$env:EMCC_TEMP_DIR = $emscriptenTempRoot

$sources = @('main.cpp','eval.cpp','fen.cpp','hash.cpp','movegen.cpp','positional.cpp','repetition.cpp','rules.cpp','search.cpp') |
    ForEach-Object { Join-Path $sourceRoot $_ }
$arguments = @(
    $empp, $sources,
    # Keep Emscripten's link step at O1: its O2+ path invokes wasm-opt with the
    # same input and output filename, which fails on this Windows setup.
    '-std=c++17', '-O1', '-DNDEBUG', '-pthread', '-fexceptions', '-sINITIAL_MEMORY=64MB', '-sALLOW_MEMORY_GROWTH',
    '-sSTACK_SIZE=3MB', '-sPTHREAD_POOL_SIZE=1', '-sMODULARIZE=1', '-sEXPORT_NAME=BruteForceWeb',
    '-sENVIRONMENT=web,worker', '-sNO_EXIT_RUNTIME=1',
    "-sEXPORTED_FUNCTIONS=['_bruteforce_command','_malloc','_free']",
    "-sEXPORTED_RUNTIME_METHODS=['stringToUTF8','lengthBytesUTF8']",
    '-o', (Join-Path $outputRoot 'bruteforce.js')
)

& $python @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Run the equivalent O3 Binaryen pass into a separate file, then replace the
# browser artifact.  wasm-opt v131 cannot reliably use the same file for both
# input and output on this machine.
$wasmOpt = Join-Path $EmsdkRoot 'upstream\bin\wasm-opt.exe'
$wasm = Join-Path $outputRoot 'bruteforce.wasm'
$optimizedWasm = Join-Path $emscriptenTempRoot 'bruteforce.optimized.wasm'
$wasmOptArguments = @(
    '--strip-target-features', '--post-emscripten', '-O3', '--low-memory-unused', '--zero-filled-memory',
    '--pass-arg=directize-initial-contents-immutable', '--no-stack-ir',
    $wasm, '-o', $optimizedWasm,
    '--mvp-features', '--enable-threads', '--enable-bulk-memory', '--enable-bulk-memory-opt',
    '--enable-call-indirect-overlong', '--enable-multivalue', '--enable-mutable-globals',
    '--enable-nontrapping-float-to-int', '--enable-reference-types', '--enable-sign-ext'
)
& $wasmOpt @wasmOptArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$wasmReplaced = $false
for ($attempt = 1; $attempt -le 10; $attempt++) {
    try {
        [System.IO.File]::Copy($optimizedWasm, $wasm, $true)
        $wasmReplaced = $true
        break
    } catch [System.IO.IOException] {
        if ($attempt -lt 10) { Start-Sleep -Seconds 1 }
    }
}
if (-not $wasmReplaced) {
    Write-Error "Cannot replace $wasm because another program has it open. Close Xiangqi Analyzer, browser tabs using the Web engine, and any local Node test server, then build again."
    exit 1
}
Remove-Item -LiteralPath $optimizedWasm -Force
Get-ChildItem -LiteralPath $outputRoot -File | Select-Object Name, Length
