// Lỗi cũ: với Threads>=2 bằng chứng hòa (go budget N) trả `bestmove (none)` vì tìm kiếm gốc song song chỉ
// ghi đường đi khi điểm là mate. Giao diện phải chạy vòng thử từng nước thủ (mỗi nước một lượt chứng minh
// đầy đủ, nhiều phút ở mốc 9) và trông như bị treo. Nay Threads=2 phải trả cùng loại kết quả như 1 luồng:
// outcome draw kèm nước giữ hợp lệ. Dùng BF_EXE để thử bản khác.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const exe = process.env.BF_EXE || path.join(__dirname, '..', 'engine', 'bruteforce-src', 'src', 'bruteforce.exe');
const fen = '9/3k5/9/9/9/9/9/4KC3/7c1/8C w - - 0 1';

function run(threads, go) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = [];
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('quá hạn: Threads=' + threads)); }, 120000);
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const raw of parts) {
        const line = raw.replace(/\r$/, '');
        lines.push(line);
        if (/^bestmove/.test(line)) { clearTimeout(timer); child.kill(); resolve(lines); }
      }
    });
    child.on('error', reject);
    child.stdin.write(['bruteforce', 'setoption name Threads value ' + threads, 'isready',
      'position fen ' + fen, go].join('\n') + '\n');
  });
}

(async () => {
  for (const go of ['go budget 6', 'go budgets red 6 black 6']) {
    const moves = {};
    for (const threads of [1, 2]) {
      const lines = await run(threads, go);
      assert(lines.includes('info string outcome draw'), `${go} Threads=${threads}: phải chứng minh hòa`);
      const best = lines.find(l => l.startsWith('bestmove')).split(' ')[1];
      assert.match(best, /^[a-i]\d[a-i]\d$/, `${go} Threads=${threads}: bestmove phải là nước thật, nhận được ${best}`);
      moves[threads] = best;
    }
    console.log(`  ${go}: Threads=1 -> ${moves[1]}, Threads=2 -> ${moves[2]}`);
  }
  console.log('PASS Threads>=2 trả nước giữ mốc khi chứng minh hòa, không còn bestmove (none)');
})().catch(error => { console.error(error); process.exitCode = 1; });
