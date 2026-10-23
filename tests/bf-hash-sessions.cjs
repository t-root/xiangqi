// Phiên Brute-force tạo SAU phiên đầu phải có bảng hash ban đầu đầy đủ (1 GiB), không được chỉ có
// bảng 16 MiB mặc định rồi tăng trưởng sớm. Lỗi cũ: RAM hiển thị 2 GiB trong khi bảng mới dùng ~5%.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const exe = path.join(__dirname, '..', 'engine', 'bruteforce-src', 'src', 'bruteforce.exe');
const fen = 'position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = [];
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  const parts = buffer.split('\n');
  buffer = parts.pop();
  for (const line of parts) lines.push(line.replace(/\r$/, ''));
});
const send = command => child.stdin.write(command + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const prepare = () => {
  send('bruteforce');
  send('setoption name Threads value 1');
  send('setoption name HashReserveMiB value 1024');
  send('setoption name CheckStreak_RestrictedColor value both');
  send('isready');
  send(fen);
};

(async () => {
  try {
    prepare();
    send('search create first');
    send('search slice first budget 8 movetime 1500');
    await sleep(3000);
    send('search cancel first');
    const secondStart = lines.length;
    prepare();
    send('search create second');
    send('search slice second budget 8 movetime 3000');
    await sleep(5000);
    const second = lines.slice(secondStart);
    const progress = second.filter(line => line.startsWith('info string progress'))
      .map(line => Object.fromEntries([...line.matchAll(/(\w+)=(\d+)/g)].map(m => [m[1], Number(m[2])])));
    assert(progress.length > 2, 'phiên thứ hai phải báo tiến độ');
    assert(second.some(line => line.startsWith('info string hash allocated')),
      'phiên thứ hai phải được cấp bảng ban đầu');
    assert(!second.some(line => line.startsWith('info string hash expanded')),
      'hash không được tăng trưởng khi bảng mới đầy một phần nhỏ');
    for (const item of progress) {
      assert.equal(item.hashAllocatedMiB, 1024, 'RAM hiển thị phải đúng 1 GiB ban đầu');
      assert(item.hashFillTenths < 900, 'bảng ban đầu không được báo đầy');
    }
    console.log('PASS phiên Brute-force thứ hai nhận đủ 1 GiB hash ban đầu và không tăng trưởng sớm');
  } finally {
    child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
