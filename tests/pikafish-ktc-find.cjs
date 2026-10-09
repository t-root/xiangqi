'use strict';
// Công cụ chẩn đoán (không nằm trong bộ chạy chính): tìm thế cờ ngẫu nhiên mà luật ktc làm đổi
// số nước tính đòn, rồi đối chiếu Brute-force (chuẩn) với Pikafish bản vá ktc.
//   node tests/pikafish-ktc-find.cjs [số thế] [seed] [budget]
// In ra các thế mà BF (ktc bật) báo budget khác BF (ktc tắt), kèm kết quả Pikafish (ktc bật/tắt).
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BF = path.join(ROOT, 'engine', 'bruteforce', 'bruteforce.exe');
const PIKA = process.env.PIKA_EXE || path.join(ROOT, 'engine', 'pikafish', 'pikafish-bmi2.exe');
const COUNT = Number(process.argv[2]) || 40;
let seed = Number(process.argv[3]) || 12345;
const BUDGET = Number(process.argv[4]) || 4;

function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

class Engine {
  constructor(exe, cwd) {
    this.proc = spawn(exe, [], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.proc.stdout.on('data', d => { this.buf += d.toString(); this.flush(); });
  }
  flush() {
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      this.waiters = this.waiters.filter(w => !w(line));
    }
  }
  send(s) { this.proc.stdin.write(s + '\n'); }
  until(pred, ms = 60000) {
    return new Promise((res, rej) => {
      const lines = [];
      const t = setTimeout(() => rej(new Error('timeout')), ms);
      this.waiters.push(line => { lines.push(line); if (pred(line)) { clearTimeout(t); res(lines); return true; } return false; });
    });
  }
  kill() { try { this.proc.kill(); } catch (_) { /* đã thoát */ } }
}

function lastMate(lines) {
  let k = null;
  for (const l of lines) { const m = l.match(/score mate (-?\d+)/); if (m) k = Number(m[1]); }
  return k;
}

// ---- Sinh thế cờ ----
const PALACE_R = [[7, 3], [7, 4], [7, 5], [8, 3], [8, 4], [8, 5], [9, 3], [9, 4], [9, 5]];
const PALACE_B = [[0, 3], [0, 4], [0, 5], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5]];
const ADV_R = [[7, 3], [7, 5], [8, 4], [9, 3], [9, 5]];
const ADV_B = [[0, 3], [0, 5], [1, 4], [2, 3], [2, 5]];
const BIS_R = [[5, 2], [5, 6], [7, 0], [7, 4], [7, 8], [9, 2], [9, 6]];
const BIS_B = [[0, 2], [0, 6], [2, 0], [2, 4], [2, 8], [4, 2], [4, 6]];

function emptyBoard() { return Array.from({ length: 10 }, () => Array(9).fill('')); }
function kingsFace(b) {
  let rk = null, bk = null;
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) { if (b[r][c] === 'K') rk = [r, c]; if (b[r][c] === 'k') bk = [r, c]; }
  if (rk[1] !== bk[1]) return false;
  for (let r = bk[0] + 1; r < rk[0]; r++) if (b[r][rk[1]]) return false;
  return true;
}
const isRed = ch => ch && ch === ch.toUpperCase();
function attacked(b, red) {
  // Tướng của bên `red` có đang bị chiếu không.
  let kr = -1, kc = -1;
  const K = red ? 'K' : 'k';
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (b[r][c] === K) { kr = r; kc = c; }
  if (kr < 0) return true;
  if (kingsFace(b)) return true;
  const at = (r, c) => (r >= 0 && r < 10 && c >= 0 && c < 9) ? b[r][c] : null;
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const p = b[r][c]; if (!p || isRed(p) === red) continue;
    const t = p.toLowerCase();
    if (t === 'r' || t === 'c') {
      if (r === kr || c === kc) {
        let n = 0;
        const dr = Math.sign(kr - r), dc = Math.sign(kc - c);
        let rr = r + dr, cc = c + dc;
        while (rr !== kr || cc !== kc) { if (b[rr][cc]) n++; rr += dr; cc += dc; }
        if (t === 'r' && n === 0) return true;
        if (t === 'c' && n === 1) return true;
      }
    } else if (t === 'n') {
      for (const [dr, dc, lr, lc] of [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]) {
        if (r + dr === kr && c + dc === kc && !at(r + lr, c + lc)) return true;
      }
    } else if (t === 'p') {
      const fwd = isRed(p) ? -1 : 1;
      if (kr === r + fwd && kc === c) return true;
      const crossed = isRed(p) ? r <= 4 : r >= 5;
      if (crossed && kr === r && Math.abs(kc - c) === 1) return true;
    }
  }
  return false;
}
function randomFen() {
  for (;;) {
    const b = emptyBoard();
    const free = [];
    const [rkr, rkc] = pick(PALACE_R); b[rkr][rkc] = 'K';
    const [bkr, bkc] = pick(PALACE_B); b[bkr][bkc] = 'k';
    const place = (ch, cells) => {
      for (let tries = 0; tries < 30; tries++) {
        const [r, c] = cells ? pick(cells) : [Math.floor(rnd() * 10), Math.floor(rnd() * 9)];
        if (!b[r][c]) { b[r][c] = ch; return; }
      }
    };
    const redPieces = ['R', 'R', 'C', 'N', 'P'].filter(() => rnd() < 0.55);
    const blackPieces = ['r', 'c', 'n', 'p', 'p'].filter(() => rnd() < 0.35);
    for (const ch of redPieces) place(ch);
    for (const ch of blackPieces) place(ch);
    for (let i = 0; i < 2; i++) if (rnd() < 0.7) place('a', ADV_B);
    for (let i = 0; i < 2; i++) if (rnd() < 0.5) place('b', BIS_B);
    if (rnd() < 0.3) place('A', ADV_R);
    // Tốt chỉ ở hàng hợp lệ.
    let bad = false;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      if (b[r][c] === 'P' && r > 6) bad = true;
      if (b[r][c] === 'p' && r < 3) bad = true;
    }
    if (bad || kingsFace(b)) continue;
    const redToMove = rnd() < 0.5;
    // Bên không đến lượt không được đang bị chiếu.
    if (attacked(b, !redToMove)) continue;
    const rows = b.map(row => {
      let s = '', n = 0;
      for (const ch of row) { if (!ch) n++; else { if (n) s += n; n = 0; s += ch; } }
      if (n) s += n; return s;
    });
    return { fen: rows.join('/') + ' ' + (redToMove ? 'w' : 'b') + ' - - 0 1', redToMove, inCheck: attacked(b, redToMove) };
  }
}

async function bfBudget(bf, fen, attackerRed, ktc, budget = BUDGET) {
  bf.send('setoption name KtcBudget value ' + (ktc ? 'true' : 'false'));
  bf.send('ucinewgame');
  bf.send('position fen ' + fen);
  bf.send('go budget ' + budget);
  const lines = await bf.until(l => l.startsWith('bestmove'), 120000);
  return lastMate(lines);
}
async function pikaMate(pk, fen, attacker, ktc) {
  pk.send('setoption name KtcBudget value ' + (ktc ? 'true' : 'false'));
  pk.send('setoption name KtcAttacker value ' + (ktc ? attacker : 'none'));
  pk.send('ucinewgame');
  pk.send('isready');
  await pk.until(l => l === 'readyok');
  pk.send('position fen ' + fen);
  pk.send('go depth ' + (BUDGET * 2 + 4));
  const lines = await pk.until(l => l.startsWith('bestmove'), 120000);
  return lastMate(lines);
}

(async () => {
  const bf = new Engine(BF, path.dirname(BF));
  const pk = new Engine(PIKA, path.dirname(PIKA));
  bf.send('bruteforce'); await bf.until(l => l === 'bruteforceok');
  pk.send('uci'); await pk.until(l => l === 'uciok');
  pk.send('setoption name Hash value 64');
  let shown = 0, scanned = 0;
  while (scanned < COUNT) {
    const { fen, redToMove } = randomFen();
    scanned++;
    try {
      const bfOn = await bfBudget(bf, fen, redToMove, true);
      const bfOff = bfOn === null ? null : await bfBudget(bf, fen, redToMove, false, BUDGET + 3);
      if (bfOn === null || bfOff === null) continue;
      if (Math.abs(bfOn) >= Math.abs(bfOff) || Math.sign(bfOn) !== Math.sign(bfOff)) continue;
      // Pika: bên tấn công = bên đang đi nếu BF thấy thắng cho họ, ngược lại là bên kia (điểm âm).
      const side = redToMove ? 'white' : 'black';
      const other = redToMove ? 'black' : 'white';
      const pOn = await pikaMate(pk, fen, side, true);
      const pOnOther = await pikaMate(pk, fen, other, true);
      const pOff = await pikaMate(pk, fen, side, false);
      console.log(JSON.stringify({ fen, bfKtcOn: bfOn, bfKtcOff: bfOff, pikaKtcOnMover: pOn, pikaKtcOnOther: pOnOther, pikaOff: pOff }));
      shown++;
    } catch (e) { console.log('lỗi', fen, e.message); }
  }
  console.log(`đã quét ${scanned} thế, ${shown} thế ktc làm đổi kết quả`);
  bf.kill(); pk.kill();
  process.exit(0);
})();
