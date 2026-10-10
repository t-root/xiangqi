# Đóng gói mọi thứ (Node + analysis.cjs + engine) thành MỘT tệp dist/analysis.exe, chạy được trên máy không cài Node/g++.
# Cần: Node >= 22.5 (để dựng), g++ (chỉ khi chưa có bin/bfanalysis.exe), mạng (npm install postject lần đầu).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$engine = Join-Path $root 'bin\bfanalysis.exe'
if (-not (Test-Path $engine)) { & (Join-Path $root 'build.ps1'); if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$config = @{
    main = (Join-Path $root 'analysis.cjs')
    output = (Join-Path $dist 'sea-prep.blob')
    disableExperimentalSEAWarning = $true
    useCodeCache = $false
    assets = @{ 'bfanalysis.exe' = $engine }
} | ConvertTo-Json -Depth 3
$cfgPath = Join-Path $dist 'sea-config.json'
[System.IO.File]::WriteAllText($cfgPath, $config, (New-Object System.Text.UTF8Encoding($false)))

$node = (Get-Command node -ErrorAction Stop).Source
& $node --experimental-sea-config $cfgPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$out = Join-Path $dist 'analysis.exe'
Copy-Item -Force $node $out
$tools = Join-Path $dist 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
& npm.cmd install --prefix $tools --no-audit --no-fund --silent postject
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $node (Join-Path $tools 'node_modules\postject\dist\cli.js') $out NODE_SEA_BLOB (Join-Path $dist 'sea-prep.blob') --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Remove-Item -Force (Join-Path $dist 'sea-prep.blob'), $cfgPath
Remove-Item -Recurse -Force $tools
Write-Output "Đã dựng $out ($([math]::Round((Get-Item $out).Length / 1MB)) MB)"
