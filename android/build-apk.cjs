// Dựng APK Android cho app cờ: trang xiangqi-analyzer.html + 2 engine native ARM64 (Pikafish,
// Brute-force) + cầu nối engine bằng Java. KHÔNG dùng Gradle: chỉ cần JDK, Android SDK (build-tools +
// platform) và Android NDK — các bước gọi thẳng aapt2 / javac / d8 / zipalign / apksigner.
//
//   node android/build-apk.cjs [--out dist/android/XiangqiAnalyzer.apk] [--force]
//
// Không có NDK/JDK/SDK thì in rõ lý do và thoát mã 2 (build-xiangqi.bat coi đó là "bỏ qua APK",
// không làm hỏng phần build còn lại).
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(__dirname, 'build');
const ENGINE_ABI = 'arm64-v8a';
const MIN_SDK = 29;     // NDK clang đích android29 (Pikafish Makefile cũng dùng 29)
const TARGET_SDK = 35;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const outIdx = args.indexOf('--out');
const OUT_APK = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(ROOT, 'dist', 'android', 'XiangqiAnalyzer.apk'));

function fail(msg, code = 1) {
    console.error('\n[APK] LOI: ' + msg);
    process.exit(code);
}
function log(msg) { console.log('[APK] ' + msg); }

// ---- tìm công cụ ---------------------------------------------------------------------------------
function exists(p) { try { return fs.existsSync(p); } catch (_) { return false; } }
function newestSubdir(dir, filter) {
    if (!exists(dir)) return null;
    const names = fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isDirectory() && (!filter || filter(n)));
    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return names.length ? path.join(dir, names[names.length - 1]) : null;
}

function findSdk() {
    const cands = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
        os.homedir() && path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')].filter(Boolean);
    return cands.find(exists) || null;
}
function findJdk() {
    const cands = [process.env.JAVA_HOME, 'C:\\Program Files\\Android\\Android Studio\\jbr',
        'C:\\Program Files\\Android\\Android Studio1\\jbr'].filter(Boolean);
    const home = cands.find(h => exists(path.join(h, 'bin', 'javac.exe')) || exists(path.join(h, 'bin', 'javac')));
    return home || null;
}

const sdk = findSdk();
if (!sdk) fail('khong tim thay Android SDK (dat ANDROID_HOME hoac cai Android Studio).', 2);
const jdk = findJdk();
if (!jdk) fail('khong tim thay JDK co javac (dat JAVA_HOME hoac cai Android Studio).', 2);
const buildTools = newestSubdir(path.join(sdk, 'build-tools'));
if (!buildTools) fail('Android SDK thieu build-tools.', 2);
const platform = exists(path.join(sdk, 'platforms', 'android-' + TARGET_SDK))
    ? path.join(sdk, 'platforms', 'android-' + TARGET_SDK)
    : newestSubdir(path.join(sdk, 'platforms'), n => /^android-\d+$/.test(n));
if (!platform) fail('Android SDK thieu platform (android-35).', 2);
const ndk = newestSubdir(path.join(sdk, 'ndk'), n => exists(path.join(sdk, 'ndk', n, 'toolchains', 'llvm')));
if (!ndk) fail('khong tim thay Android NDK trong ' + path.join(sdk, 'ndk') + ' (can NDK r27c tro len).', 2);
const llvmBin = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin');
if (!exists(llvmBin)) fail('NDK khong co toolchain windows-x86_64: ' + llvmBin, 2);

const exe = (n) => n + (process.platform === 'win32' ? '.exe' : '');
const JAVA = path.join(jdk, 'bin', exe('java'));
const JAVAC = path.join(jdk, 'bin', exe('javac'));
const JAR = path.join(jdk, 'bin', exe('jar'));
const KEYTOOL = path.join(jdk, 'bin', exe('keytool'));
const AAPT2 = path.join(buildTools, exe('aapt2'));
const ZIPALIGN = path.join(buildTools, exe('zipalign'));
const D8_JAR = path.join(buildTools, 'lib', 'd8.jar');
const APKSIGNER_JAR = path.join(buildTools, 'lib', 'apksigner.jar');
const ANDROID_JAR = path.join(platform, 'android.jar');
const CLANGXX = path.join(llvmBin, exe('clang++'));
const STRIP = path.join(llvmBin, exe('llvm-strip'));
for (const f of [JAVA, JAVAC, JAR, KEYTOOL, AAPT2, ZIPALIGN, D8_JAR, APKSIGNER_JAR, ANDROID_JAR, CLANGXX, STRIP]) {
    if (!exists(f)) fail('thieu cong cu: ' + f, 2);
}
log(`SDK=${sdk}\n      NDK=${path.basename(ndk)} build-tools=${path.basename(buildTools)} platform=${path.basename(platform)} JDK=${jdk}`);

// ---- tiện ích ------------------------------------------------------------------------------------
function run(cmd, argv, opts = {}) {
    const r = cp.spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
    if (r.error) fail(`khong chay duoc ${path.basename(cmd)}: ${r.error.message}`);
    if (r.status !== 0) fail(`${path.basename(cmd)} that bai (ma ${r.status}).`);
}
function runAsync(cmd, argv, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = cp.spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
        p.on('error', reject);
        p.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} that bai (ma ${code}): ${argv.slice(-1)[0]}`)));
    });
}
function walk(dir, filter, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, filter, out);
        else if (!filter || filter(p)) out.push(p);
    }
    return out;
}
const mtime = (p) => fs.statSync(p).mtimeMs;
const newest = (files) => files.reduce((m, f) => Math.max(m, mtime(f)), 0);
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
async function pool(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) { const i = next++; await worker(items[i], i); }
    });
    await Promise.all(runners);
}
const JOBS = Math.max(1, os.cpus().length);
const TARGET = `--target=aarch64-linux-android${MIN_SDK}`;

// ---- engine native ARM64 ---------------------------------------------------------------------------
const LIB_DIR = path.join(BUILD, 'lib', ENGINE_ABI);

function buildBruteforce() {
    const src = path.join(ROOT, 'engine', 'bruteforce-src', 'src');
    const out = path.join(LIB_DIR, 'libbruteforce.so');
    const names = ['main.cpp', 'eval.cpp', 'fen.cpp', 'hash.cpp', 'movegen.cpp', 'positional.cpp', 'repetition.cpp', 'rules.cpp', 'search.cpp'];
    const stamp = newest([...names.map(n => path.join(src, n)),
        ...walk(src, f => f.endsWith('.h')), __filename]);
    if (!FORCE && exists(out) && mtime(out) > stamp) { log('Brute-force ARM64: da moi, bo qua.'); return; }
    log('Dang build Brute-force cho ARM64...');
    fs.mkdirSync(LIB_DIR, { recursive: true });
    run(CLANGXX, [TARGET, '-std=c++17', '-O3', '-pthread', '-static-libstdc++', '-fuse-ld=lld',
        '-Wl,-z,max-page-size=16384', '-o', out, ...names], { cwd: src });
    run(STRIP, [out]);
}

async function buildPikafish(libName, archName, extraFlags) {
    const src = path.join(ROOT, 'engine', 'pikafish-src', 'src');
    const out = path.join(LIB_DIR, libName);
    const sources = walk(src, f => /\.(cpp|S)$/.test(f) && !/[\\/](universal|temp_builds|obj[^\\/]*)[\\/]/.test(f));
    const headers = walk(src, f => f.endsWith('.h') && !/[\\/](universal|temp_builds|obj[^\\/]*)[\\/]/.test(f));
    const stamp = Math.max(newest(sources), newest(headers), mtime(__filename));
    if (!FORCE && exists(out) && mtime(out) > stamp) { log(`Pikafish ARM64 (${archName}): da moi, bo qua.`); return; }
    log(`Dang build Pikafish cho ARM64 (${archName}) bang ${JOBS} luong, mat vai phut...`);
    // Bộ cờ y hệt "make ARCH=<arch> COMP=ndk" của Makefile Pikafish (in ra từ `make build`).
    const flags = ['-w', '-fno-exceptions', '-std=c++17', '-stdlib=libc++', '-DNDEBUG', '-O3',
        '-funroll-loops', '-DIS_64BIT', '-DUSE_POPCNT', '-DUSE_NEON=8', ...extraFlags, `-DARCH=${archName}`,
        '-flto=full', '-fPIE', '-Xclang', '-mllvm', '-Xclang', '-inline-threshold=500'];
    const objDir = path.join(BUILD, 'obj', archName);
    rmrf(objDir);
    fs.mkdirSync(objDir, { recursive: true });
    const objs = [];
    const jobs = sources.map((s, i) => {
        const o = path.join(objDir, String(i).padStart(3, '0') + '_' + path.basename(s).replace(/\.\w+$/, '') + '.o');
        objs.push(o);
        return { s, o };
    });
    // cwd = src để include tương đối giống Makefile (không có -I).
    await pool(jobs, JOBS, ({ s, o }) => runAsync(CLANGXX, [TARGET, ...flags, '-c', '-o', o, path.relative(src, s)], { cwd: src }));
    fs.mkdirSync(LIB_DIR, { recursive: true });
    log(`Dang lien ket Pikafish (${archName}) (LTO)...`);
    run(CLANGXX, [TARGET, '-o', out, ...objs, '-static-libstdc++', '-fuse-ld=lld', ...flags, '-pie', '-Wl,-z,max-page-size=16384']);
    run(STRIP, [out]);
    rmrf(objDir);
}

// ---- icon ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
// Quân cờ đơn giản: đĩa đỏ, viền trắng, vòng trong đen — vẽ bằng khoảng cách tới tâm, có khử răng cưa.
function makeIconPng(size) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    const cx = (size - 1) / 2, cy = cx;
    const R = size * 0.48;
    const cover = (d, r) => Math.max(0, Math.min(1, r - d + 0.5));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x - cx, y - cy);
            const o = y * (size * 4 + 1) + 1 + x * 4;
            const disc = cover(d, R);
            let r = 225, g = 29, b = 47;                                  // đỏ
            const ring = cover(d, R * 0.82) - cover(d, R * 0.74);         // vòng trắng
            const mix = (cr, cg, cb, a) => { r = r * (1 - a) + cr * a; g = g * (1 - a) + cg * a; b = b * (1 - a) + cb * a; };
            mix(255, 255, 255, cover(d, R) - cover(d, R * 0.9));          // viền ngoài trắng
            mix(255, 255, 255, ring);
            mix(20, 24, 40, cover(d, R * 0.3));                           // chấm giữa tối
            raw[o] = Math.round(r); raw[o + 1] = Math.round(g); raw[o + 2] = Math.round(b); raw[o + 3] = Math.round(disc * 255);
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---- đóng gói ------------------------------------------------------------------------------------------
function stageAssets() {
    const assets = path.join(BUILD, 'assets');
    rmrf(assets);
    const www = path.join(assets, 'www');
    fs.mkdirSync(path.join(assets, 'engines'), { recursive: true });
    fs.mkdirSync(www, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'xiangqi-analyzer.html'), path.join(www, 'xiangqi-analyzer.html'));
    const vision = path.join(ROOT, 'vision');
    if (exists(vision)) {
        fs.cpSync(vision, path.join(www, 'vision'), { recursive: true, filter: (s) => !/NGUON\.md$/.test(s) });
    }
    fs.copyFileSync(path.join(__dirname, 'shim', 'xq-ws-shim.js'), path.join(assets, 'xq-ws-shim.js'));
    const nnue = path.join(ROOT, 'engine', 'pikafish', 'pikafish.nnue');
    if (!exists(nnue)) fail('thieu ' + nnue + ' (file NNUE cua Pikafish).');
    fs.copyFileSync(nnue, path.join(assets, 'engines', 'pikafish.nnue'));
    return assets;
}

function ensureKeystore() {
    const ks = path.join(__dirname, 'debug.keystore');
    if (!exists(ks)) {
        log('Tao keystore debug (chi lan dau)...');
        run(KEYTOOL, ['-genkeypair', '-keystore', ks, '-storepass', 'android', '-keypass', 'android', '-alias', 'xiangqi',
            '-keyalg', 'RSA', '-keysize', '2048', '-validity', '36500', '-dname', 'CN=Xiangqi Analyzer']);
    }
    return ks;
}

async function main() {
    const t0 = Date.now();
    fs.mkdirSync(BUILD, { recursive: true });

    // 1) Engine ARM64 (bỏ qua nếu chưa đổi mã nguồn).
    buildBruteforce();
    await buildPikafish('libpikafish.so', 'armv8', []);
    await buildPikafish('libpikafish_dp.so', 'armv8-dotprod', ['-march=armv8.2-a+dotprod', '-DUSE_NEON_DOTPROD']);

    // 2) Tài nguyên + manifest.
    const assets = stageAssets();
    const res = path.join(BUILD, 'res');
    rmrf(res);
    const iconDir = path.join(res, 'mipmap-xxxhdpi');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.writeFileSync(path.join(iconDir, 'ic_launcher.png'), makeIconPng(192));
    const resZip = path.join(BUILD, 'res.zip');
    rmrf(resZip);
    run(AAPT2, ['compile', '--dir', res, '-o', resZip]);

    const baseApk = path.join(BUILD, 'base.apk');
    rmrf(baseApk);
    const versionCode = Math.floor(Date.now() / 60000); // tăng dần mỗi lần build để cài đè được
    run(AAPT2, ['link', '-o', baseApk, '-I', ANDROID_JAR, '--manifest', path.join(__dirname, 'AndroidManifest.xml'),
        '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK),
        '--version-code', String(versionCode), '--version-name', '1.0', resZip]);

    // 3) Java -> dex.
    const classes = path.join(BUILD, 'classes');
    rmrf(classes);
    fs.mkdirSync(classes, { recursive: true });
    const javaFiles = walk(path.join(__dirname, 'src'), f => f.endsWith('.java'));
    run(JAVAC, ['-encoding', 'UTF-8', '--release', '17', '-Xlint:-options', '-cp', ANDROID_JAR, '-d', classes, ...javaFiles]);
    const classesJar = path.join(BUILD, 'classes.jar');
    rmrf(classesJar);
    run(JAR, ['--create', '--file', classesJar, '--no-manifest', '-C', classes, '.']);
    const dexDir = path.join(BUILD, 'dex');
    rmrf(dexDir);
    fs.mkdirSync(dexDir, { recursive: true });
    run(JAVA, ['-cp', D8_JAR, 'com.android.tools.r8.D8', '--release', '--min-api', String(MIN_SDK),
        '--lib', ANDROID_JAR, '--output', dexDir, classesJar]);

    // 4) Ghép dex + engine vào APK rồi căn lề và ký.
    run(JAR, ['--update', '--file', baseApk, '--no-manifest', '-C', dexDir, 'classes.dex', '-C', BUILD, 'lib']);
    // Assets thêm bằng `jar`, KHÔNG dùng `aapt2 link -A`: aapt2 trên Windows ghi tên entry bằng dấu
    // gạch ngược (assets/www\xiangqi-analyzer.html) nên Android không tìm thấy file. `jar` luôn dùng '/'.
    // --no-compress: lưu nguyên (nnue/onnx/wasm vốn không nén được; html/js lưu thô cho AssetManager đọc thẳng).
    run(JAR, ['--update', '--file', baseApk, '--no-manifest', '--no-compress', '-C', BUILD, 'assets']);
    // Chặn tái phát: mọi tên entry trong APK phải dùng '/'.
    const listing = cp.spawnSync(JAR, ['--list', '--file', baseApk], { encoding: 'utf8' });
    if (listing.status !== 0) fail('khong liet ke duoc noi dung APK.');
    const names = listing.stdout.split(/\r?\n/).filter(Boolean);
    const bad = names.filter(n => n.includes('\\'));
    if (bad.length) fail('ten file trong APK co dau gach nguoc: ' + bad.slice(0, 3).join(', '));
    for (const need of ['assets/www/xiangqi-analyzer.html', 'assets/xq-ws-shim.js', 'assets/engines/pikafish.nnue',
        'lib/arm64-v8a/libpikafish.so', 'lib/arm64-v8a/libpikafish_dp.so', 'lib/arm64-v8a/libbruteforce.so', 'classes.dex']) {
        if (!names.includes(need)) fail('APK thieu entry: ' + need);
    }
    const aligned = path.join(BUILD, 'aligned.apk');
    rmrf(aligned);
    run(ZIPALIGN, ['-f', '-p', '4', baseApk, aligned]);
    const ks = ensureKeystore();
    fs.mkdirSync(path.dirname(OUT_APK), { recursive: true });
    rmrf(OUT_APK);
    run(JAVA, ['-jar', APKSIGNER_JAR, 'sign', '--ks', ks, '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
        '--ks-key-alias', 'xiangqi', '--min-sdk-version', String(MIN_SDK), '--out', OUT_APK, aligned]);
    rmrf(OUT_APK + '.idsig');

    const mb = (fs.statSync(OUT_APK).size / 1048576).toFixed(1);
    log(`XONG: ${OUT_APK} (${mb} MB) trong ${Math.round((Date.now() - t0) / 1000)} giay.`);
}

main().catch(err => fail(err && err.message ? err.message : String(err)));
