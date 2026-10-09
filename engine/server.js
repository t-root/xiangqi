// MỘT entry point duy nhất, để đóng gói bằng `pkg` ra một file .exe chạy được không cần cài Node
// (và cũng không cần cài Python cho phần server tĩnh nữa).
//
// Chạy dev (chưa đóng gói): node server.js
// Chạy sau khi đóng gói:    XiangqiAnalyzer.exe
//
// Mở: http://localhost:9999/xiangqi-analyzer.html
// Bridge Pikafish:  ws://localhost:8899
// Bridge Brute-force:  ws://localhost:8900

const { spawn, execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HTTP_PORT = 9999;

// --- Lấy IP mạng nội bộ -------------------------------------------------------
// Trả về { real, virtual }: IPv4 của card thật (Wi-Fi/Ethernet) và của card ảo.
function listLocalIPs() {
    const interfaces = os.networkInterfaces();
    const real = [];
    const virtual = [];

    // Card ảo (Hyper-V Default Switch, WSL, VMware, VirtualBox, Docker...) có IP kiểu 172.x.0.1 mà
    // điện thoại không với tới được — bỏ xuống cuối danh sách, ưu tiên card thật (Wi-Fi/Ethernet).
    const VIRTUAL_NAME = /vethernet|wsl|hyper-v|vmware|virtualbox|vbox|docker|loopback|bluetooth|tailscale|zerotier/i;
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Chỉ lấy IPv4 không phải loopback, bỏ link-local 169.254.x.x
            if (iface.family !== 'IPv4' || iface.internal || iface.address.startsWith('169.254.')) continue;
            (VIRTUAL_NAME.test(name) ? virtual : real).push(iface.address);
        }
    }

    return { real, virtual };
}

function getLocalIP() {
    const { real, virtual } = listLocalIPs();
    const lan = real.find(ip => /^(192\.168|10)\./.test(ip));
    return lan || real[0] || virtual[0] || 'localhost';
}

// --- Xác định thư mục làm việc thật trên đĩa ---------------------------------------------------
// Khi chạy qua `node server.js` bình thường, __dirname là engine/ thật. Khi đã đóng gói bằng pkg,
// __dirname trỏ vào một "snapshot" ảo bên trong file .exe — các file nằm trong đó ĐỌC được bằng
// fs, nhưng KHÔNG spawn() được (Windows cần một đường dẫn thật trên đĩa để chạy .exe con). Vì vậy
// khi đóng gói, phải tự chép các file cần spawn/serve ra một thư mục thật cạnh file .exe trước.
const isPkg = typeof process.pkg !== 'undefined';
// Keep all runtime files in one predictable, user-visible folder next to the
// packaged executable.  This also makes the Chrome extension easy to find.
const DATA_DIR = isPkg ? path.join(path.dirname(process.execPath), 'xiangqi_data') : path.join(__dirname, '..');

function sameFileContent(a, b) {
    const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return digest(a) === digest(b);
}

function ensureExtracted(snapshotRelPath, destAbsPath, verifyContent = false) {
    const srcAbsPath = path.join(__dirname, snapshotRelPath);
    if (fs.existsSync(destAbsPath) && fs.statSync(destAbsPath).size === fs.statSync(srcAbsPath).size &&
        (!verifyContent || sameFileContent(srcAbsPath, destAbsPath))) return;
    fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
    fs.copyFileSync(srcAbsPath, destAbsPath);
}

function ensureExtractedDirectory(snapshotRelDir, destAbsDir) {
    const srcAbsDir = path.join(__dirname, snapshotRelDir);
    fs.mkdirSync(destAbsDir, { recursive: true });
    for (const entry of fs.readdirSync(srcAbsDir, { withFileTypes: true })) {
        const sourceRel = path.join(snapshotRelDir, entry.name);
        const destination = path.join(destAbsDir, entry.name);
        if (entry.isDirectory()) ensureExtractedDirectory(sourceRel, destination);
        else if (entry.isFile()) ensureExtracted(sourceRel, destination, true);
    }
}

// Bộ nhận diện ảnh bàn cờ: runtime ONNX (WebAssembly) + hai model. Trình duyệt tải qua HTTP nên
// khi đóng gói phải bung ra đĩa cạnh file .exe giống xiangqi-analyzer.html.
const VISION_FILES = [
    'vision/ort/ort.wasm.min.js',
    'vision/ort/ort-wasm-simd.wasm',
    'vision/ort/ort-wasm.wasm',
    'vision/models/online_xiangqi_piece_detector.onnx',
    'vision/models/online_xiangqi_classifier.onnx',
];

const PIKAFISH_WEB_FILES = [
    'pikafish.js',
    'pikafish.wasm',
    'pikafish.data',
];
const BRUTEFORCE_WEB_FILES = [
    'bruteforce.js',
    'bruteforce.wasm',
];

// Pikafish Web: 4 file WASM/JS/data/nnue trình duyệt tải qua HTTP khi người dùng chọn engine thứ 4.
// Cũng phải bung ra đĩa cạnh file .exe khi đóng gói, vì giống xiangqi-analyzer.html, chúng nằm
// trong snapshot ảo của pkg và trình duyệt không fetch được trực tiếp từ đó. Đường dẫn trong pkg
// "assets" bắt đầu bằng "../" vì file thật nằm ở thư mục gốc dự án (cạnh xiangqi-analyzer.html),
// còn pkg chạy với cwd là engine/.
let PIKAFISH_DIR, PIKAFISH_EXE, BRUTEFORCE_DIR, BRUTEFORCE_EXE, HTML_PATH;
if (isPkg) {
    console.log('Đang chuẩn bị file chạy (lần đầu có thể mất vài giây)...');
    PIKAFISH_DIR = path.join(DATA_DIR, 'pikafish');
    PIKAFISH_EXE = path.join(PIKAFISH_DIR, 'pikafish-bmi2.exe');
    ensureExtracted(path.join('pikafish', 'pikafish-bmi2.exe'), PIKAFISH_EXE, true);
    ensureExtracted(path.join('pikafish', 'pikafish.nnue'), path.join(PIKAFISH_DIR, 'pikafish.nnue'));

    BRUTEFORCE_DIR = path.join(DATA_DIR, 'bruteforce');
    BRUTEFORCE_EXE = path.join(BRUTEFORCE_DIR, 'bruteforce.exe');
    // Không dựa riêng vào kích thước: hai bản BF khác nhau có thể trùng số byte.
    ensureExtracted(path.join('bruteforce-src', 'src', 'bruteforce.exe'), BRUTEFORCE_EXE, true);

    HTML_PATH = path.join(DATA_DIR, 'xiangqi-analyzer.html');
    ensureExtracted(path.join('..', 'xiangqi-analyzer.html'), HTML_PATH, true);
    // Trang nạp file này ở đầu <head> (cho máy chủ tĩnh không đặt được header COOP/COEP, vd. app
    // web-server trên điện thoại). Server này đã tự đặt header nên bản .exe chỉ cần bung ra đĩa để
    // không 404 và để chép cả thư mục xiangqi_data sang máy khác là chạy được.
    try { ensureExtracted(path.join('..', 'coi-serviceworker.js'), path.join(DATA_DIR, 'coi-serviceworker.js'), true); }
    catch (e) { console.warn(`Không bung được coi-serviceworker.js: ${e.message}`); }

    for (const rel of VISION_FILES) {
        // Thiếu file nhận diện thì app vẫn chạy được (tự lùi về nhánh dự phòng), nên không cho
        // một model hỏng làm chết cả server.
        try { ensureExtracted(path.join('..', rel), path.join(DATA_DIR, rel)); }
        catch (e) { console.warn(`Không bung được ${rel}: ${e.message}`); }
    }

    // Pikafish Web: cũng cần bung, NHƯNG thiếu thì engine này coi như không có — đừng làm app
    // crash cứng khi người dùng không chọn Pikafish Web mà file đã lỡ xoá. Đường dẫn đích lấy từ
    // DATA_DIR (cùng chỗ với xiangqi-analyzer.html) để static-server /pikafish-web/* hoạt động
    // không cần sửa thêm.
    for (const file of PIKAFISH_WEB_FILES) {
        try {
            ensureExtracted(path.join('..', 'pikafish-web', file), path.join(DATA_DIR, 'pikafish-web', file));
        } catch (e) {
            console.warn(`Không bung được Pikafish Web ${file}: ${e.message}`);
        }
    }
    for (const file of BRUTEFORCE_WEB_FILES) {
        try {
            ensureExtracted(path.join('..', 'bruteforce-web', file), path.join(DATA_DIR, 'bruteforce-web', file));
        } catch (e) {
            console.warn(`Không bung được Brute-force Web ${file}: ${e.message}`);
        }
    }

    // Package the TikTok auto-reply extension alongside the app so users can
    // load it from xiangqi_data without a separate ZIP download.
    try {
        ensureExtractedDirectory(
            path.join('..', 'tiktok_auto_reply_extension'),
            path.join(DATA_DIR, 'tiktok_auto_reply_extension')
        );
    } catch (e) {
        console.warn(`Could not extract TikTok extension: ${e.message}`);
    }
} else {
    PIKAFISH_DIR = path.join(__dirname, 'pikafish');
    PIKAFISH_EXE = path.join(PIKAFISH_DIR, 'pikafish-bmi2.exe');
    // Chạy trực tiếp từ output build mới nhất. Khi app đang mở, Windows khóa bản
    // deploy cũ trong engine/bruteforce; dùng bản source-build này để Web/native
    // luôn cùng một lõi, còn gói .exe cũng lấy chính file này qua pkg assets.
    BRUTEFORCE_DIR = path.join(__dirname, 'bruteforce-src', 'src');
    BRUTEFORCE_EXE = path.join(BRUTEFORCE_DIR, 'bruteforce.exe');
    HTML_PATH = path.join(__dirname, '..', 'xiangqi-analyzer.html');
}

// --- Dò + tắt tiến trình cũ đang chiếm cổng -----------------------------------------------------
// Windows-only (netstat/taskkill), dùng đường dẫn đầy đủ tới System32 vì một số shell (Git Bash)
// không có System32 sẵn trong PATH.
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
function killPortIfBusy(port) {
    let out;
    try {
        out = execSync(
            `"${SYSTEM32}\\netstat.exe" -ano -p tcp | "${SYSTEM32}\\findstr.exe" :${port} | "${SYSTEM32}\\findstr.exe" LISTENING`,
            { encoding: 'utf8' });
    } catch (e) {
        return;  // findstr không khớp dòng nào -> cổng đang rảnh.
    }
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== String(process.pid)) pids.add(pid);
    }
    for (const pid of pids) {
        console.log(`Cổng ${port} đang bị chiếm (PID ${pid}) — đang tắt để khởi động lại không xung đột...`);
        try { execSync(`"${SYSTEM32}\\taskkill.exe" /F /PID ${pid}`); } catch (e) { /* có thể vừa tự thoát, bỏ qua */ }
    }
    if (pids.size > 0) {
        const sab = new SharedArrayBuffer(4);
        Atomics.wait(new Int32Array(sab), 0, 0, 800);
    }
}

// --- Mở Firewall cho các cổng cần thiết ---------------------------------------------------
function openFirewall(port, label) {
    try {
        const ruleName = `Xiangqi ${label} ${port}`;
        execSync(
            `"${SYSTEM32}\\netsh.exe" advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=tcp localport=${port} enable=yes`,
            { encoding: 'utf8', stdio: 'pipe' });
        console.log(`✅ Đã mở Firewall cho cổng ${port} (${label})`);
    } catch (e) {
        // Rule có thể đã tồn tại hoặc không có quyền admin - bỏ qua
    }
}

// --- Bridge UCI <-> WebSocket dùng chung cho cả Pikafish và Brute-force -----------------------
// MỖI kết nối WebSocket (= mỗi tab trình duyệt) có TIẾN TRÌNH ENGINE RIÊNG, tách hẳn khỏi các tab
// khác — mở nhiều tab thì phân tích song song, không tab nào giành/đá tab nào ra nữa. TRƯỚC ĐÂY cả
// bridge chỉ có MỘT tiến trình dùng chung cho mọi kết nối: tab mới mở sẽ đóng socket của (các) tab
// cũ (mã lỗi 4001) rồi mới nhận kết nối mới, vì một tiến trình UCI không tự tách được hai lượt
// "go"/"position" chồng nhau từ hai tab khác nhau. Đổi lại việc tách riêng: mỗi tab đang mở tốn
// thêm một tiến trình engine riêng (CPU/RAM cộng dồn theo số tab đang mở) — mở rất nhiều tab cùng
// lúc thì máy yếu có thể đuối, nhưng đổi lại không còn xung đột engine giữa các tab.
// crashTag: mã trong dòng "info string <TAG>_CRASHED" mà trang web dò để biết engine vừa chết giữa
// một lượt tìm kiếm. PHẢI truyền rõ, KHÔNG suy ra từ label: label là chữ hiển thị (đổi tên engine là
// đổi theo), còn tag là giao thức — hai bên lệch nhau thì app treo mãi không biết engine đã chết.
function startBridge({ label, crashTag, port, exePath, exeDir }) {
    killPortIfBusy(port);

    let sessionSeq = 0;

    // Một "phiên" = một tiến trình engine riêng, gắn với đúng MỘT kết nối WebSocket (đúng một tab).
    // Toàn bộ state (searchInFlight, hàng đợi lệnh, cờ restart...) nằm trong closure riêng của phiên
    // này — không còn biến dùng chung cho cả bridge như bản cũ — nên hai phiên/hai tab không thể
    // giẫm lên trạng thái tìm kiếm của nhau. tag chỉ để gắn nhãn log, phân biệt tab #1, #2...
    function createSession(ws, tag) {
        let engine = null;
        let searchInFlight = false;
        let restartRequested = false;
        let restartTimer = null;
        let shutdownRequested = false;
        const queuedCommands = [];
        const afterSearch = [];
        let stopSent = false;

        function send(line) {
            if (ws.readyState === ws.OPEN) ws.send(line);
        }

        function startEngine() {
            console.log(`[${label} ${tag}] Đang khởi động:`, exePath);
            let child;
            try { child = spawn(exePath, [], { cwd: exeDir, windowsHide: true }); }
            catch (error) {
                engine = null;
                restartRequested = false;
                send(`info string ${crashTag}_CRASHED spawn ${error.code || error.message}`);
                console.error(`[${label} ${tag}]`, error);
                return;
            }
            engine = child;
            restartRequested = false;
            shutdownRequested = false;

            let buf = '';
            child.stdout.on('data', (chunk) => {
                if (engine !== child || shutdownRequested) return;
                buf += chunk.toString('utf8');
                const lines = buf.split(/\r?\n/);
                buf = lines.pop();
                for (const line of lines) {
                    if (!line.length) continue;
                    if (line.startsWith('bestmove')) {
                        searchInFlight = false;
                        stopSent = false;
                    }
                    send(line);
                    if (line.startsWith('bestmove')) {
                        const pending = afterSearch.splice(0);
                        for (const command of pending) sendToEngine(command);
                    }
                }
            });
            child.stderr.on('data', (chunk) => {
                console.error(`[${label} ${tag} stderr]`, chunk.toString('utf8'));
            });
            const onEngineFailure = (code, signal) => {
                // Nếu đã có lượt mới khởi động thay thế, sự kiện thoát của tiến trình cũ
                // không được phép xóa handle hoặc kích hoạt restart cho lượt mới.
                if (engine !== child) return;
                const wasRequested = shutdownRequested;
                console.error(`${label} ${tag} đã thoát (code=${code}, signal=${signal})${wasRequested ? ' — đã dừng theo yêu cầu.' : ' — khởi động lại sau 1 giây.'}`);
                if (!wasRequested) send(`info string ${crashTag}_CRASHED code=${code} signal=${signal}`);
                searchInFlight = false;
                afterSearch.length = 0;
                stopSent = false;
                engine = null;
                if (wasRequested) {
                    restartRequested = false;
                    queuedCommands.length = 0;
                    return;
                }
                send(`info string ${label} process exited, restarting...`);
                restartRequested = true;
                if (!restartTimer) {
                    restartTimer = setTimeout(() => {
                        restartTimer = null;
                        startEngine();
                        while (queuedCommands.length && engine && !engine.killed) {
                            sendToEngine(queuedCommands.shift());
                        }
                    }, 1000);
                }
            };
            // Spawn failures do not emit exit; broken stdin is an asynchronous error.
            // Both must be handled or Node terminates both engine bridges.
            child.on('error', error => onEngineFailure(error.code || error.message, null));
            child.stdin.on('error', error => {
                if (engine !== child) return;
                try { child.kill(); } catch (_) {}
                onEngineFailure(error.code || error.message, null);
            });
            child.on('close', onEngineFailure);
        }

        function forceStopEngine() {
            const current = engine;
            shutdownRequested = true;
            restartRequested = false;
            queuedCommands.length = 0;
            afterSearch.length = 0;
            stopSent = false;
            if (restartTimer) {
                clearTimeout(restartTimer);
                restartTimer = null;
            }
            if (!current || current.killed) return;
            if (searchInFlight) send(`info string ${crashTag}_CRASHED`);
            searchInFlight = false;
            console.log(`[${label} ${tag}] dừng hẳn engine của phiên này để không còn tiến trình chạy ngầm.`);
            try { current.kill(); } catch (e) { /* tiến trình đã thoát */ }
        }

        function sendToEngine(line) {
            if (line.trim() === '__force_shutdown__') {
                forceStopEngine();
                return;
            }
            if (!engine || engine.killed || engine.exitCode !== null || engine.stdin.destroyed) {
                if (shutdownRequested) {
                    startEngine();
                    if (!engine || engine.killed) return;
                } else if (restartRequested) queuedCommands.push(line);
                else console.warn(`[${label} ${tag}] chưa sẵn sàng, bỏ qua lệnh:`, line);
                if (!engine || engine.killed) return;
            }
            const startsSearch = /^(?:go(?:\s|$)|search\s+(?:slice|resume)(?:\s|$))/.test(line);
            if (searchInFlight && line !== 'stop' && line !== 'quit') {
                // Pikafish position frees state still used by its search thread, and
                // setoption waits for that thread. Wait for stop completion first.
                afterSearch.push(line);
                if (!stopSent) { engine.stdin.write('stop\n'); stopSent = true; }
                return;
            }
            if (line === 'stop') stopSent = true;
            if (startsSearch) searchInFlight = true;
            engine.stdin.write(line + '\n');
        }

        startEngine();

        return { sendToEngine, forceStopEngine };
    }

    const onConnection = (ws) => {
        const tag = `#${++sessionSeq}`;
        console.log(`[${label} ${tag}] Trình duyệt vừa kết nối — khởi động engine riêng cho tab này.`);
        const session = createSession(ws, tag);
        ws.on('error', error => console.warn(`[${label} ${tag}] WebSocket: ${error.message}`));
        ws.on('message', (data) => {
            for (const line of data.toString('utf8').split(/\r?\n/)) {
                if (line.trim()) session.sendToEngine(line.trim());
            }
        });
        ws.on('close', () => {
            console.log(`[${label} ${tag}] Trình duyệt đã ngắt kết nối — dừng engine riêng của tab này.`);
            session.forceStopEngine();
        });
    };

    // Cổng riêng (ws://) cho trang http://. Trang https:// không được phép mở ws:// thường (mixed
    // content) nên còn một đường nữa: wss://<host>:9999/ws/... đi qua server HTTPS ở dưới, dùng
    // chung cổng và chung chứng chỉ với trang → điện thoại chỉ phải chấp nhận cảnh báo MỘT lần.
    const wss = new WebSocketServer({ port });
    wss.on('connection', onConnection);
    const routed = new WebSocketServer({ noServer: true });
    routed.on('connection', onConnection);

    const localIP = getLocalIP();
    console.log(`Cầu nối ${label} đang chạy tại ws://localhost:${port} (mỗi tab một engine riêng)`);
    console.log(`  Từ mạng nội bộ: ws://${localIP}:${port}`);
    return routed;
}

openFirewall(9999, 'HTTP');
openFirewall(8899, 'Pikafish');
openFirewall(8900, 'Brute-force');

const WS_ROUTES = {
    '/ws/pikafish': startBridge({ label: 'Pikafish', crashTag: 'PIKAFISH', port: 8899, exePath: PIKAFISH_EXE, exeDir: PIKAFISH_DIR }),
    '/ws/bruteforce': startBridge({ label: 'Brute-force', crashTag: 'BRUTEFORCE', port: 8900, exePath: BRUTEFORCE_EXE, exeDir: BRUTEFORCE_DIR }),
};

// --- Server tĩnh cho xiangqi-analyzer.html (thay "python -m http.server") ----------------------
killPortIfBusy(HTTP_PORT);
// Trình duyệt từ chối chạy <script> nếu Content-Type không phải kiểu javascript, và
// WebAssembly.instantiateStreaming đòi đúng 'application/wasm' — thiếu hai dòng này thì bộ nhận
// diện ảnh không nạp được.
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.onnx': 'application/octet-stream',
};
// Pikafish Web (Emscripten WASM) reference SharedArrayBuffer khi dò tính năng thread lúc khởi tạo,
// kể cả khi đã build đơn luồng. SharedArrayBuffer chỉ có khi trang ở trạng thái "cross-origin
// isolated", tức là response phải có đủ:
//   • Cross-Origin-Opener-Policy: same-origin       — cho phép SAB
//   • Cross-Origin-Embedder-Policy: require-corp    — bắt buộc mọi sub-resource cũng phải CORP hoặc CORS
//   • Cross-Origin-Resource-Policy: same-origin     — áp cho tài nguyên self-host để browser chấp nhận
//     khi embedder yêu cầu CORP. Áp cho MỌI response của server này vì mọi file đều self-host, và
//     Pikafish Web loader cũng load trực tiếp (cùng origin).
// Lưu ý phạm vi: header này chỉ ảnh hưởng người dùng mở app qua http://localhost:9999 — không ảnh
// hưởng WebSocket port 8899/8900 (Node ws không quan tâm COOP/COEP).
const ISOLATION_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
};
const requestHandler = (req, res) => {
    // URL hỏng (vd. "/%") làm decodeURIComponent ném URIError; không bắt thì cả server + 2 bridge sập.
    let reqPath;
    try { reqPath = decodeURIComponent(req.url.split('?')[0]); }
    catch (e) { res.writeHead(400, ISOLATION_HEADERS).end('Bad request'); return; }
    const fileName = reqPath === '/' ? 'xiangqi-analyzer.html' : reqPath.replace(/^\//, '');
    const filePath = path.join(DATA_DIR, fileName);
    if (!filePath.startsWith(DATA_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, ISOLATION_HEADERS).end('Not found');
        return;
    }
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        ...ISOLATION_HEADERS,
    });
    // File đang bị khóa/đọc lỗi giữa chừng: không có handler 'error' thì Node ném lỗi chưa bắt và sập.
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
};

// --- HTTPS tự ký (để điện thoại/LAN chạy được engine Web) ----------------------------------------
// Engine Web (WASM đa luồng) cần SharedArrayBuffer ⇒ trang phải "cross-origin isolated" ⇒ trình duyệt
// chỉ cho phép ở secure context: https:// hoặc http://localhost. http://192.168.x.x thì KHÔNG. Cách
// gọn nhất không cần tên miền/tunnel: tự ký một chứng chỉ chứa đúng các IP LAN của máy này. Lần đầu
// mở, trình duyệt cảnh báo "không an toàn" → chọn tiếp tục; chỉ phải làm một lần cho mỗi thiết bị
// (chứng chỉ được giữ lại giữa các lần chạy; chỉ tạo lại khi đổi IP LAN hoặc sắp hết hạn).
const CERT_DIR = path.join(isPkg ? DATA_DIR : __dirname, 'certs');

async function loadOrCreateCert() {
    const keyFile = path.join(CERT_DIR, 'key.pem');
    const certFile = path.join(CERT_DIR, 'cert.pem');
    const { real, virtual } = listLocalIPs();
    const ips = ['127.0.0.1', ...real, ...virtual];
    try {
        const cert = fs.readFileSync(certFile);
        const x509 = new crypto.X509Certificate(cert);
        const fresh = new Date(x509.validTo).getTime() > Date.now() + 30 * 24 * 3600 * 1000;
        if (fresh && ips.every(ip => x509.checkIP(ip))) return { key: fs.readFileSync(keyFile), cert };
    } catch (e) { /* chưa có / hỏng → tạo mới */ }

    const selfsigned = require('selfsigned');
    const altNames = [{ type: 2, value: 'localhost' }, { type: 2, value: os.hostname() },
        ...ips.map(ip => ({ type: 7, ip }))];
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'Xiangqi Analyzer' }], {
        keySize: 2048, algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames }],
    });
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    return { key: pems.private, cert: pems.cert };
}

// Gắn WebSocket của bridge vào cùng cổng HTTP(S): /ws/pikafish và /ws/bruteforce.
function routeUpgrade(req, socket, head) {
    const route = WS_ROUTES[req.url.split('?')[0]];
    if (!route) { socket.destroy(); return; }
    route.handleUpgrade(req, socket, head, ws => route.emit('connection', ws, req));
}

// Một cổng phục vụ cả http:// lẫn https://: byte đầu của kết nối TLS luôn là 0x16 (ClientHello),
// còn HTTP thường bắt đầu bằng chữ cái (GET/POST...). Nhìn byte đầu rồi giao cho server tương ứng.
function listenDual(port, plainServer, tlsServer, onListening) {
    const front = net.createServer((sock) => {
        sock.on('error', () => {});
        sock.once('data', (buf) => {
            sock.pause();
            sock.unshift(buf);
            (tlsServer && buf[0] === 0x16 ? tlsServer : plainServer).emit('connection', sock);
            process.nextTick(() => sock.resume());
        });
    });
    front.listen(port, '0.0.0.0', onListening);
}

const httpServer = http.createServer(requestHandler);
httpServer.on('upgrade', routeUpgrade);

loadOrCreateCert().catch((e) => {
    console.warn('⚠️ Không tạo được chứng chỉ HTTPS — chỉ chạy HTTP:', e.message);
    return null;
}).then((tlsOptions) => {
    let httpsServer = null;
    if (tlsOptions) {
        httpsServer = https.createServer(tlsOptions, requestHandler);
        httpsServer.on('upgrade', routeUpgrade);
        httpsServer.on('tlsClientError', () => {}); // trình duyệt từ chối chứng chỉ tự ký → bình thường, đừng ồn
    }
    listenDual(HTTP_PORT, httpServer, httpsServer, onHttpListening(httpsServer !== null));
});

function onHttpListening(hasHttps) { return () => {
    const localIP = getLocalIP();
    const localhostUrl = `http://localhost:${HTTP_PORT}`;
    const networkUrl = `http://${localIP}:${HTTP_PORT}`;

    console.log(`Server tĩnh đang chạy tại ${localhostUrl}`);
    console.log(`  Từ mạng nội bộ: ${networkUrl}`);
    if (hasHttps) {
        console.log(`  Điện thoại (HTTPS, chạy được cả engine Web): https://${localIP}:${HTTP_PORT}`);
        console.log(`     → lần đầu trình duyệt báo "không an toàn": chọn Nâng cao → Tiếp tục truy cập.`);
    }
    console.log(`  ⚠️ Nếu vẫn không kết nối:`);
    console.log(`     • Chạy CMD/PowerShell với Admin để mở Firewall tự động`);
    console.log(`     • Hoặc thêm cổng ${HTTP_PORT}, 8899, 8900 vào Firewall Windows thủ công`);
    
    console.log('Đang mở trình duyệt...');
    try { execSync(`start "" "${localhostUrl}"`, { shell: 'cmd.exe' }); } catch (e) { console.warn('Không tự mở được trình duyệt, hãy tự mở:', localhostUrl); }
}; }
