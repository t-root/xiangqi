'use strict';
// Đo số node và thời gian từng mức budget của `go budget N`, để biết phần "quét lại từ gốc"
// chiếm bao nhiêu so với mức cuối. Dùng:
//   node tests/bf-rewrite/measure-levels.cjs <exe> "<fen>" <budget> [restricted=none|both|white|black] [limit]
const path = require('path');
const { BfClient } = require('./bfclient.cjs');

(async () => {
  const exe = path.resolve(process.argv[2] || 'tests/binaries/bruteforce.reference.exe');
  const fen = process.argv[3] || '9/3k5/9/9/9/9/9/4KC3/7c1/8C w';
  const budget = parseInt(process.argv[4] || '5', 10);
  const restricted = process.argv[5] || 'none';
  const limit = parseInt(process.argv[6] || '2', 10);
  // BF_EXTRA="setoption name SearchHints value true;setoption name ..." — thêm lệnh gửi trước khi dò.
  const extra = (process.env.BF_EXTRA || '').split(';').map(s => s.trim()).filter(Boolean);
  const client = new BfClient(exe, { restricted, limit, extra });
  const res = await client.go('position fen ' + fen, 'go budget ' + budget);
  let prev = 0;
  console.log('mức | nodes cộng dồn | nodes của mức | ms | điểm');
  for (const info of res.infos) {
    const own = info.nodes - prev;
    prev = info.nodes;
    console.log(`${info.depth} | ${info.nodes} | ${own} | ${info.time} | ${info.scoreType} ${info.scoreVal}`);
  }
  console.log('bestmove', res.bestmove, 'outcome', res.outcome);
  client.quit();
})().catch(e => { console.error(e); process.exit(1); });
