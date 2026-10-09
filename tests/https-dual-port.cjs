// Kiểm tra server tĩnh phục vụ http:// VÀ https:// (chứng chỉ tự ký) trên CÙNG một cổng, và bridge
// engine đi được qua cả ws:// lẫn wss://…/ws/pikafish. Không đụng launcher/firewall thật: chạy một
// BẢN SAO engine/server.js đã đổi sang cổng thử, tắt mở firewall và tắt tự mở trình duyệt, chứng
// chỉ ghi vào thư mục tạm.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { WebSocket } = require(path.join(__dirname, '..', 'engine', 'node_modules', 'ws'));

const HTTP = 19991, PIKA = 19992, BF = 19993;
const engineDir = path.join(__dirname, '..', 'engine');
const copy = path.join(engineDir, '.https-dual-port-test.js');
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangqi-cert-'));

let src = fs.readFileSync(path.join(engineDir, 'server.js'), 'utf8');
const patches = [
    [/HTTP_PORT = 9999/, `HTTP_PORT = ${HTTP}`],
    [/port: 8899/, `port: ${PIKA}`],
    [/port: 8900/, `port: ${BF}`],
    [/^openFirewall\(.*$/gm, ''],
    [/execSync\(`start ""/, 'execSync(`rem ""'],
    [/path\.join\(isPkg \? DATA_DIR : __dirname, 'certs'\)/, JSON.stringify(certDir)],
];
for (const [re, to] of patches) {
    if (!re.test(src)) throw new Error('Không vá được server.js, mẫu đã đổi: ' + re);
    src = src.replace(re, to);
}
fs.writeFileSync(copy, src);

const child = spawn(process.execPath, [copy], { cwd: engineDir, windowsHide: true });
let log = '';
const cleanup = () => {
    try { child.kill(); } catch (_) {}
    try { fs.rmSync(copy, { force: true }); } catch (_) {}
    try { fs.rmSync(certDir, { recursive: true, force: true }); } catch (_) {}
};
const fail = (msg) => { console.error('FAIL ' + msg + '\n--- log server ---\n' + log); cleanup(); process.exit(1); };
setTimeout(() => fail('quá thời gian chờ'), 60000).unref();

const get = (mod, port) => new Promise((resolve, reject) => {
    mod.get({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
    }).on('error', reject);
});

const uci = (url) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    ws.on('open', () => ws.send('uci'));
    ws.on('message', (d) => { if (String(d).includes('uciok')) { ws.close(); resolve(); } });
    ws.on('error', reject);
});

const opens = (url) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    ws.on('open', () => { ws.close(); resolve(); });
    ws.on('error', reject);
});

async function run() {
    for (const [name, mod, port] of [['http', http, HTTP], ['https', https, HTTP]]) {
        const { res, body } = await get(mod, port);
        if (res.statusCode !== 200 || !body.includes(Buffer.from('<html'))) throw new Error(`${name}: trang chính không trả về đúng`);
        if (res.headers['cross-origin-opener-policy'] !== 'same-origin') throw new Error(`${name}: thiếu header COOP`);
    }
    const cert = new crypto.X509Certificate(fs.readFileSync(path.join(certDir, 'cert.pem')));
    if (!cert.checkIP('127.0.0.1') || !cert.checkHost('localhost')) throw new Error('chứng chỉ thiếu SAN localhost/127.0.0.1');
    const { real } = Object.values(os.networkInterfaces()).flat().reduce((a, i) => (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.') && a.real.push(i.address), a), { real: [] });
    for (const ip of real) if (!cert.checkIP(ip)) throw new Error('chứng chỉ thiếu IP LAN ' + ip);
    await uci(`wss://127.0.0.1:${HTTP}/ws/pikafish`);
    await uci(`ws://127.0.0.1:${HTTP}/ws/pikafish`);
    await uci(`ws://127.0.0.1:${PIKA}`);
    await opens(`wss://127.0.0.1:${HTTP}/ws/bruteforce`); // trang chỉ cần kết nối mở được, Brute-force không bắt tay uci
    await new Promise((resolve, reject) => {  // đường lạ phải bị từ chối
        const ws = new WebSocket(`wss://127.0.0.1:${HTTP}/ws/khong-co`, { rejectUnauthorized: false });
        ws.on('open', () => reject(new Error('đường /ws/khong-co lẽ ra phải bị từ chối')));
        ws.on('error', () => resolve());
    });
}

child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
const poll = setInterval(() => {
    if (!log.includes('Server tĩnh đang chạy')) return;
    clearInterval(poll);
    run().then(() => {
        console.log('PASS http/https cùng một cổng; chứng chỉ có SAN localhost + IP LAN; ws/wss tới Pikafish & Brute-force; đường lạ bị từ chối');
        cleanup();
        process.exit(0);
    }).catch(e => fail(e.message));
}, 100);
child.on('exit', (code) => { if (code) fail('server thoát sớm, mã ' + code); });
