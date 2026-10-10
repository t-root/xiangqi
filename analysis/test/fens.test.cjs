// Kiểm thử các FEN đã dùng để phân tích. Chạy: node --test test/
//  - Kiểm tra cú pháp FEN (luôn chạy).
//  - Chạy engine với các thế đã biết có mate và so số nước mate (cần bin/bfanalysis.exe; thiếu thì bỏ qua).
//    Đặt FEN_SLOW=1 để chạy cả thế mate dài (chậm hơn).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FENS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fens.json'), 'utf8'));
const HAS_ENGINE = fs.existsSync(path.join(ROOT, 'bin', 'bfanalysis.exe'));

function checkFen(fen) {
  const [board, side, ...rest] = fen.trim().split(/\s+/);
  const ranks = board.split('/');
  assert.strictEqual(ranks.length, 10, 'phải có 10 hàng');
  const count = {};
  for (const r of ranks) {
    let files = 0;
    for (const ch of r) {
      if (/[1-9]/.test(ch)) files += +ch;
      else if (/[rnbakcpRNBAKCP]/.test(ch)) { files++; count[ch] = (count[ch] || 0) + 1; }
      else assert.fail('ký tự lạ: ' + ch);
    }
    assert.strictEqual(files, 9, `hàng "${r}" phải đủ 9 cột`);
  }
  assert.strictEqual(count.K, 1, 'phải có đúng 1 Tướng đỏ');
  assert.strictEqual(count.k, 1, 'phải có đúng 1 Tướng đen');
  assert.ok(side === 'w' || side === 'b', 'bên đi phải là w hoặc b');
  assert.strictEqual(rest.length, 4, 'thiếu phần đuôi FEN');
}

test('tên và FEN không trùng nhau', () => {
  assert.strictEqual(new Set(FENS.map((f) => f.name)).size, FENS.length);
  assert.strictEqual(new Set(FENS.map((f) => f.fen)).size, FENS.length);
});

for (const f of FENS) {
  test(`cú pháp FEN: ${f.name}`, () => checkFen(f.fen));
}

for (const f of FENS.filter((x) => x.mate)) {
  const slow = f.mate > 5;
  const skip = !HAS_ENGINE ? 'chưa có bin/bfanalysis.exe (chạy build.ps1)' : slow && !process.env.FEN_SLOW ? 'thế mate dài, đặt FEN_SLOW=1 để chạy' : false;
  test(`engine tìm mate ${f.mate}: ${f.name}`, { skip, timeout: 10 * 60 * 1000 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fen-test-'));
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'analysis.cjs'), '--fen', f.fen, '--budget', String(f.mate + 2),
        '--data', dir, '--threads', '2', '--json', '--allow-sleep'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, 'mã thoát phải là 0 (có mate)\n' + r.stdout + r.stderr);
      const res = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.strictEqual(res.outcome, 'mate');
      assert.strictEqual(res.mate.k, f.mate);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
