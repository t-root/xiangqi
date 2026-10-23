// Lệnh "go budget" (không phiên) phải đếm nút từ 0 và không mang bảng lịch sử của lượt trước: cùng một
// thế cờ chạy nhiều lần phải báo đúng cùng số nút. Lỗi cũ: bộ đếm cộng dồn nên lần sau báo nhiều hơn.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const exe = path.join(__dirname, '..', 'engine', 'bruteforce-src', 'src', 'bruteforce.exe');
const fen = 'position fen 9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1';
const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = [];
let buffer = '';
let waiter = null;
child.stdout.on('data', chunk => {
  buffer += chunk;
  const parts = buffer.split('\n');
  buffer = parts.pop();
  for (const raw of parts) {
    const line = raw.replace(/\r$/, '');
    lines.push(line);
    if (waiter && waiter.re.test(line)) { const done = waiter.resolve; waiter = null; done(); }
  }
});
const send = command => child.stdin.write(command + '\n');
const until = re => new Promise(resolve => { waiter = { re, resolve }; });
const mateNodes = from => {
  const line = lines.slice(from).filter(l => /^info depth \d+ score mate/.test(l)).pop();
  const match = line && /nodes (\d+)/.exec(line);
  return match ? Number(match[1]) : null;
};

(async () => {
  const timer = setTimeout(() => { console.error('quá hạn'); child.kill(); process.exit(1); }, 120000);
  try {
    send('bruteforce');
    send('setoption name Threads value 1');
    send('setoption name CheckStreak_RestrictedColor value both');
    send('isready');
    const counts = [];
    for (let i = 0; i < 3; i++) {
      const start = lines.length;
      send(fen);
      send('go budget 6 movetime 60000');
      await until(/^bestmove/);
      counts.push(mateNodes(start));
    }
    assert(counts.every(Number.isFinite), 'phải thấy mate ở cả ba lượt: ' + counts);
    assert.deepEqual(counts, [counts[0], counts[0], counts[0]], 'cùng thế cờ phải cùng số nút: ' + counts);
    console.log('PASS lệnh go không phiên đếm nút từ 0 và cho cùng số nút mỗi lượt (' + counts[0] + ')');
  } finally {
    clearTimeout(timer);
    child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
