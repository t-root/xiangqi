'use strict';
// Luật ktc trong Pikafish bản tự build (engine/pikafish-src): option KtcBudget + KtcAttacker.
// Các giá trị mong đợi lấy từ Brute-force (chuẩn của luật này) trên đúng các thế đó, xem
// tests/pikafish-ktc-find.cjs. Pikafish là tìm kiếm chọn lọc nên dùng depth dư (20).
//   PIKA_EXE=<đường dẫn> node tests/pikafish-ktc.cjs   (mặc định engine/pikafish/pikafish-bmi2.exe)
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const PIKA = process.env.PIKA_EXE || path.join(ROOT, 'engine', 'pikafish', 'pikafish-bmi2.exe');
const DEPTH = 20;

class Uci {
  constructor() {
    this.proc = spawn(PIKA, [], { cwd: path.dirname(PIKA), stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.proc.stdout.on('data', d => { this.buf += d.toString(); this.pump(); });
  }
  pump() {
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      this.waiters = this.waiters.filter(w => !w(line));
    }
  }
  send(s) { this.proc.stdin.write(s + '\n'); }
  until(pred, ms = 120000) {
    return new Promise((res, rej) => {
      const lines = [];
      const t = setTimeout(() => rej(new Error('Pikafish không phản hồi')), ms);
      this.waiters.push(line => { lines.push(line); if (pred(line)) { clearTimeout(t); res(lines); return true; } return false; });
    });
  }
  async ready() { this.send('isready'); await this.until(l => l === 'readyok'); }
  // Trả { mate, pv } của dòng info cuối cùng; mate = null nếu không báo mate.
  async search(fen, opts) {
    this.send('setoption name KtcBudget value ' + (opts.ktc ? 'true' : 'false'));
    this.send('setoption name KtcAttacker value ' + (opts.attacker || 'none'));
    this.send('ucinewgame');
    await this.ready();
    this.send('position fen ' + fen);
    this.send('go depth ' + DEPTH);
    const lines = await this.until(l => l.startsWith('bestmove'));
    let mate = null, pv = '';
    for (const l of lines) {
      const m = l.match(/ score mate (-?\d+).* pv (.+)$/);
      if (m) { mate = Number(m[1]); pv = m[2]; }
      else if (/ score cp /.test(l)) { mate = null; pv = ''; }
    }
    return { mate, pv, lines };
  }
  kill() { try { this.proc.kill(); } catch (_) { /* đã thoát */ } }
}

// ok = số nước tính đòn Brute-force báo khi ktc BẬT; off = số nước thật (ktc tắt).
const CASES = [
  // Đỏ đang bị Tốt đen chiếu: Tướng chạy (miễn) rồi chiếu bí 2 nước tính đòn, thực tế 3 nước.
  { name: 'tướng chạy khỏi chiếu ở gốc', fen: '4k4/4a1R2/1P6b/9/9/9/9/3A5/2RC2N2/3pK4 w - - 0 1', attacker: 'white', on: 2, off: 3 },
  // Tướng chạy ở giữa đường (sau nước Mã đen chiếu): 3 nước tính đòn, 4 nước thật.
  { name: 'tướng chạy giữa đường', fen: '5k3/6C2/5a3/9/9/5R3/9/9/1R1K5/N5n2 w - - 0 1', attacker: 'white', on: 3, off: 4 },
  // Bên đi trước THUA: bên tấn công là Đen, số âm.
  { name: 'bên tấn công là Đen (điểm âm)', fen: '9/4a4/5k3/1rN6/9/9/9/9/9/3K5 w - - 0 1', attacker: 'black', on: -4, off: -5 }
];

(async () => {
  const pk = new Uci();
  pk.send('uci'); await pk.until(l => l === 'uciok');
  pk.send('setoption name Hash value 64');

  const uciText = (await (async () => { pk.send('uci'); return pk.until(l => l === 'uciok'); })()).join('\n');
  assert(/option name KtcBudget type check default false/.test(uciText), 'thiếu option KtcBudget');
  assert(/option name KtcAttacker type string default none/.test(uciText), 'thiếu option KtcAttacker');
  console.log('PASS Pikafish khai báo KtcBudget (mặc định tắt) và KtcAttacker (mặc định none)');

  for (const c of CASES) {
    const off = await pk.search(c.fen, { ktc: false });
    assert.strictEqual(off.mate, c.off, `${c.name}: ktc tắt phải ra ${c.off} nước thật, nhận ${off.mate}`);

    // KtcBudget bật nhưng chưa nói bên tấn công = vẫn là Pikafish chuẩn.
    const noSide = await pk.search(c.fen, { ktc: true, attacker: 'none' });
    assert.strictEqual(noSide.mate, off.mate, `${c.name}: thiếu KtcAttacker phải coi như tắt`);
    assert.strictEqual(noSide.pv, off.pv, `${c.name}: thiếu KtcAttacker không được đổi đường đi`);

    // KtcAttacker có mà KtcBudget tắt = cũng tắt.
    const noFlag = await pk.search(c.fen, { ktc: false, attacker: c.attacker });
    assert.strictEqual(noFlag.mate, off.mate, `${c.name}: KtcBudget tắt phải coi như tắt`);

    const on = await pk.search(c.fen, { ktc: true, attacker: c.attacker });
    assert.strictEqual(on.mate, c.on, `${c.name}: ktc bật phải ra ${c.on} nước tính đòn, nhận ${on.mate}`);
    assert(Math.abs(on.mate) < Math.abs(off.mate), `${c.name}: ktc phải giảm số nước`);
    console.log(`PASS ${c.name}: ktc bật ${on.mate}, tắt ${off.mate}`);
  }

  // Bật rồi tắt lại phải trở về đúng kết quả chuẩn (bảng băm được xóa khi đổi cấu hình).
  const first = CASES[0];
  await pk.search(first.fen, { ktc: true, attacker: first.attacker });
  const again = await pk.search(first.fen, { ktc: false });
  assert.strictEqual(again.mate, first.off, 'tắt ktc lại phải về số nước thật');
  console.log('PASS bật rồi tắt ktc không để sót điểm cũ trong bảng băm');

  pk.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
