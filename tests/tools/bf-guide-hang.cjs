// Chẩn đoán: chạy BF với lệnh go và in tiến độ (thưa) để tìm chỗ treo.
// Dùng: node tests/tools/bf-guide-hang.cjs "<fen>" "<go command>" [giây] [threads]
const path = require('node:path');
const { spawn } = require('node:child_process');
const exe = path.join(__dirname, '..', '..', 'engine', 'bruteforce-src', 'src', 'bruteforce.exe');
const [fen, go, sec = '120', threads = '1'] = process.argv.slice(2);
const limit = Number(sec) * 1000;
const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const t0 = Date.now();
let buf = '', lastP = -99;
child.stdout.on('data', c => {
  buf += c; const parts = buf.split('\n'); buf = parts.pop();
  for (const raw of parts) {
    const l = raw.replace(/\r$/, ''), t = (Date.now() - t0) / 1000;
    const prog = /progress/.test(l);
    if (!prog || t - lastP >= 10) { if (prog) lastP = t; console.log(t.toFixed(1) + 's ' + l); }
    if (/^bestmove/.test(l)) { child.kill(); process.exit(0); }
  }
});
const send = s => child.stdin.write(s + '\n');
send('bruteforce'); send('setoption name Threads value ' + threads);
for (const o of (process.env.BF_OPTS || '').split(';').filter(Boolean)) send('setoption name ' + o);
send('isready'); send('position fen ' + fen); send(go);
setTimeout(() => { console.log('TIMEOUT sau ' + sec + 's'); child.kill(); process.exit(2); }, limit);
