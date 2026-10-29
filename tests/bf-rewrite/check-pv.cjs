'use strict';
// Kiểm chứng đường (PV) mate mà bản thử trả về bằng chính bản tham chiếu: đi từng nước của PV rồi hỏi
// `go budgets` với số nước còn lại của mỗi bên.
//   * sau nước của BÊN CÔNG: bên thủ (đang tới lượt) phải bị ép thua trong ngân sách còn lại;
//   * sau nước của BÊN THỦ: bên công (đang tới lượt) phải có thắng ép trong ngân sách còn lại;
//   * mọi nước phải hợp lệ (engine báo lỗi nếu nước không hợp lệ);
//   * thế cuối của PV: bên đi hết nước hoặc (luật chiếu) nước cuối phạm luật.
// Dùng: node tests/bf-rewrite/check-pv.cjs <cand.jsonl> [restricted=none] [limit=2]
// Chỉ kiểm các thế có mate ở mức cuối. Bên công = bên đi trước nếu mate dương, ngược lại là đối phương.
const fs = require('fs');
const path = require('path');
const { BfClient } = require('./bfclient.cjs');

const ref = path.resolve(__dirname, '..', 'binaries', 'bruteforce.reference.exe');
const rows = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const restricted = process.argv[3] || 'none';
const limit = parseInt(process.argv[4] || '2', 10);

(async () => {
  let checked = 0, bad = 0;
  const client = new BfClient(ref, { restricted, limit });
  for (const row of rows) {
    if (!row.levels || !row.levels.length) continue;
    const last = row.levels[row.levels.length - 1];
    if (last.type !== 'mate' || !last.pv.length) continue;
    const level = last.depth;
    const win = last.val > 0;                       // bên đi trước thắng
    const sideToMove = row.fen.split(' ')[1] === 'w' ? 'red' : 'black';
    const attacker = win ? sideToMove : (sideToMove === 'red' ? 'black' : 'red');
    // Màu của từng nước trong PV: xen kẽ bắt đầu từ bên đi trước.
    let mover = sideToMove;
    const used = { red: 0, black: 0 };
    let ok = true, why = '';
    for (let i = 0; i < last.pv.length && ok; i++) {
      used[mover]++;
      const prefix = last.pv.slice(0, i + 1);
      const next = mover === 'red' ? 'black' : 'red';
      const isFinal = i === last.pv.length - 1;
      if (!isFinal) {
        const r = await client.go(`position fen ${row.fen} moves ${prefix.join(' ')}`,
          `go budgets red ${level - used.red} black ${level - used.black}`);
        const info = r.infos[r.infos.length - 1];
        const expectNegative = mover === attacker;   // bên đi kế là bên thủ → phải bị mate (âm)
        if (!info || info.scoreType !== 'mate' || (expectNegative ? info.scoreVal >= 0 : info.scoreVal <= 0)) {
          ok = false;
          why = `sau nước ${i + 1} (${mover}) kỳ vọng ${expectNegative ? 'bên thủ bị mate' : 'bên công thắng'}, nhận ` +
            (info ? `${info.scoreType} ${info.scoreVal}` : 'không có info');
        }
      } else if (restricted === 'none') {
        // Thế cuối: bên đi tiếp theo phải hết nước đi. Hỏi go budgets 1/1: không còn nước thì báo mate âm 0.
        const r = await client.go(`position fen ${row.fen} moves ${prefix.join(' ')}`, 'go budgets red 1 black 1');
        const info = r.infos[r.infos.length - 1];
        if (!info || info.scoreType !== 'mate' || info.scoreVal > 0) {
          ok = false;
          why = `thế cuối không phải thế hết nước: ${info ? info.scoreType + ' ' + info.scoreVal : 'không có info'}`;
        }
      }
      mover = next;
    }
    checked++;
    if (!ok) { bad++; console.log('SAI', row.fen, last.pv.join(' '), '\n  ', why); }
  }
  console.log(`đã kiểm ${checked} PV, sai ${bad}`);
  client.quit();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
