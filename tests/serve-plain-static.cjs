// Máy chủ tĩnh KHÔNG đặt header COOP/COEP, giả lập app web-server trên điện thoại để thử
// coi-serviceworker.js. Chạy: node tests/serve-plain-static.cjs  → http://localhost:19997/xiangqi-analyzer.html
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };
const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
}).listen(19997, () => console.log('http://localhost:19997/xiangqi-analyzer.html'));
setTimeout(() => srv.close(() => process.exit(0)), 10 * 60 * 1000).unref();
