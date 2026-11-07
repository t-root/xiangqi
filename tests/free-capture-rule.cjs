'use strict';
// Kiểm tra luật "võ tân" (CheckStreak_FreeCapture) bằng các thế mẫu nhỏ trên Brute-force.
// Bên bị giới hạn là ĐỎ (option "white"), quân Xe e5 mang sẵn chuỗi chiếu (CheckStreak_RootRed).
const { spawn } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');
const BF = path.resolve(__dirname, '..', 'engine', 'bruteforce', 'bruteforce.exe');

function run(fen, { free, bonus = false, rootRed = 'none', limit = 2, budget = 3 }) {
  return new Promise((resolve, reject) => {
    const p = spawn(BF, [], { cwd: path.dirname(BF) });
    let buf = '', last = '';
    const tm = setTimeout(() => { p.kill(); reject(new Error('timeout')); }, 60000);
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (/ score /.test(l)) last = l;
      if (l === 'bruteforceok') p.stdin.write([
        'setoption name CheckStreak_RestrictedColor value white', `setoption name CheckStreak_Limit value ${limit}`,
        `setoption name CheckStreak_BonusRule value ${bonus}`, `setoption name CheckStreak_FreeCapture value ${free}`,
        `setoption name CheckStreak_RootRed value ${rootRed}`, 'setoption name KtcBudget value false',
        'ucinewgame', `position fen ${fen}`, `go budget ${budget}`, ''].join('\n'));
      if (l.startsWith('bestmove')) { clearTimeout(tm); p.kill(); resolve({ last, best: l }); } } });
    p.stdin.write('bruteforce\n');
  });
}
const mateIn = r => { const m = / score mate (\d+)/.exec(r.last); return m ? +m[1] : null; };

// Đỏ: Xe d5 e5 f5, Tướng d0. Đen: Tướng e9, Tốt e7 chắn giữa Xe e5 và Tướng.
// Xe e5 ăn Tốt e7 là chiếu bí ngay (d9, f9 bị hai Xe kia khoá, e8 bị Xe e7 khoá).
const FEN = '4k4/9/4p4/9/3RRR3/9/9/9/9/3K5 w - - 0 1';
(async () => {
  let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('PASS ' + name); };
  await t('chưa chiếu lần nào: Xe ăn Tốt chiếu bí (mate 1) dù tắt võ tân', async () =>
    assert.equal(mateIn(await run(FEN, { free: false })), 1));
  await t('Xe đã chiếu 1 lần: nước ăn-cản thành lần 2, vẫn hợp lệ, mate 1', async () =>
    assert.equal(mateIn(await run(FEN, { free: false, rootRed: 'e5:1:0' })), 1));
  await t('Xe đã chiếu 2 lần, TẮT võ tân: ăn Tốt là lần 3 -> phạm luật, không còn mate 1', async () =>
    assert.notEqual(mateIn(await run(FEN, { free: false, rootRed: 'e5:2:0' })), 1));
  await t('Xe đã chiếu 2 lần, BẬT võ tân: ăn-cản không tính -> mate 1', async () =>
    assert.equal(mateIn(await run(FEN, { free: true, rootRed: 'e5:2:0' })), 1));
  await t('BẬT võ tân + lão nhị cùng lúc: võ tân được ưu tiên -> mate 1', async () =>
    assert.equal(mateIn(await run(FEN, { free: true, bonus: true, rootRed: 'e5:2:0' })), 1));
  await t('Xe đã chiếu 3 lần (limit 3): tắt -> phạm; bật -> mate 1', async () => {
    assert.notEqual(mateIn(await run(FEN, { free: false, rootRed: 'e5:3:0', limit: 3 })), 1);
    assert.equal(mateIn(await run(FEN, { free: true, rootRed: 'e5:3:0', limit: 3 })), 1);
  });
  // Xe a5 ăn Tốt a9 là chiếu bí, nhưng Tốt a9 KHÔNG nằm giữa Xe và Tướng (nó là đích đến) -> không phải ăn-cản.
  const FEN2 = 'p3k4/7R1/9/9/R8/9/9/9/9/3K5 w - - 0 1';
  await t('ăn quân KHÔNG nằm giữa Xe và Tướng thì võ tân không miễn (vẫn phạm ở lần 3)', async () => {
    assert.equal(mateIn(await run(FEN2, { free: false, rootRed: 'a5:1:0' })), 1);
    assert.notEqual(mateIn(await run(FEN2, { free: true, rootRed: 'a5:2:0' })), 1);
  });
  console.log(`PASS ${n} nhóm kiểm tra võ tân`);
})().catch(e => { console.error(e); process.exit(1); });
