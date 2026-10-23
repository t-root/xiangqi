'use strict';
// Chạy một bản bruteforce.exe trên kho thế và ghi kết quả từng mức vào JSONL, để so với bản khác
// bằng compare.cjs. Mỗi thế dùng một tiến trình mới (số node tất định, không dính killer/history
// của thế trước).
//   node tests/bf-rewrite/corpus-run.cjs <exe> <positions.txt> <out.jsonl> <budget> [moveTimeMs]
// Biến môi trường: BF_RESTRICTED=none|both|white|black, BF_LIMIT=2, BF_KTC=1, BF_EXTRA="setoption ...;..."
const fs = require('fs');
const path = require('path');
const { BfClient } = require('./bfclient.cjs');

(async () => {
  const exe = path.resolve(process.argv[2]);
  const positions = fs.readFileSync(process.argv[3], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = process.argv[4];
  const budget = parseInt(process.argv[5] || '4', 10);
  const moveTime = parseInt(process.argv[6] || '0', 10);
  const extra = (process.env.BF_EXTRA || '').split(';').map(s => s.trim()).filter(Boolean);
  const options = {
    restricted: process.env.BF_RESTRICTED || 'none', limit: parseInt(process.env.BF_LIMIT || '2', 10),
    ktc: process.env.BF_KTC === '1', extra
  };
  const fd = fs.openSync(out, 'w');
  let done = 0;
  for (const fen of positions) {
    const client = new BfClient(exe, options);
    const t0 = Date.now();
    let res;
    try {
      res = await client.go('position fen ' + fen, 'go budget ' + budget + (moveTime ? ' movetime ' + moveTime : ''),
        moveTime ? moveTime + 60000 : 900000);
    } catch (e) {
      fs.writeSync(fd, JSON.stringify({ fen, error: String(e.message || e) }) + '\n');
      client.quit();
      continue;
    }
    const levels = res.infos.map(i => ({ depth: i.depth, type: i.scoreType, val: i.scoreVal, nodes: i.nodes, pv: i.pv }));
    const last = res.infos[res.infos.length - 1];
    fs.writeSync(fd, JSON.stringify({
      fen, levels, bestmove: res.bestmove, outcome: res.outcome,
      nodes: last ? last.nodes : 0, engMs: last ? last.time : 0, ms: Date.now() - t0
    }) + '\n');
    client.quit();
    if (++done % 25 === 0) console.error(done + '/' + positions.length);
  }
  fs.closeSync(fd);
})().catch(e => { console.error(e); process.exit(1); });
