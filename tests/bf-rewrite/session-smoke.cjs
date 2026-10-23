'use strict';
// Kiểm nhanh đường phiên ấm (`search create` / `search slice ... movetime`) mà phân tích theo giờ dùng:
// chạy lát ngắn nhiều lần tới khi hết partial, rồi so mức/độ dài mate cuối với chạy một lượt `go budget`.
//   node tests/bf-rewrite/session-smoke.cjs <exe> [sliceMs=150]
const path = require('path');
const { BfClient } = require('./bfclient.cjs');

const exe = path.resolve(process.argv[2]);
const sliceMs = parseInt(process.argv[3] || '150', 10);
const maxBudget = 6;
const positions = [
  '3k5/9/8R/P8/9/9/4N4/4BA3/4K4/5A3 w - - 0 1',
  '3k5/9/R8/4C4/2p6/9/6P2/4B4/3N5/3AKABN1 w - - 0 1',
  '2R1kabn1/4a4/9/R8/9/9/2P1r1P2/9/9/3A1K3 b - - 0 1',
  '9/3k5/9/9/9/9/9/4KC3/7c1/8C w - - 0 1',
];

async function sliced(fen, extra) {
  const c = new BfClient(exe, { extra });
  await c.ready();
  c.send('position fen ' + fen);
  c.send('search create smoke');
  await c.waitFor(l => l.indexOf('search created') >= 0);
  const seen = new Map();
  let last = null, slices = 0;
  for (; slices < 400; slices++) {
    const start = c.lines.length;
    c.send(`search slice smoke budget ${maxBudget} movetime ${sliceMs}`);
    await c.waitFor(l => l.indexOf('bestmove') === 0, 120000);
    const out = c.lines.slice(start);
    const parsed = require('./bfclient.cjs').parseGoOutput(out);
    for (const i of parsed.infos) seen.set(i.depth, `${i.scoreType}:${i.scoreVal}:${i.pv.length}`);
    last = parsed;
    if (parsed.outcome !== 'partial') break;
  }
  c.quit();
  return { levels: [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => `${d}=${v}`).join(' '), outcome: last.outcome, slices };
}

(async () => {
  let bad = 0;
  for (const fen of positions) {
    const tree = await sliced(fen, ['setoption name RetainedTree value true']);
    const legacy = await sliced(fen, ['setoption name RetainedTree value false']);
    const same = tree.levels === legacy.levels && tree.outcome === legacy.outcome;
    if (!same) bad++;
    console.log(`${same ? 'OK ' : 'KHÁC'} ${fen}\n   tree  (${tree.slices + 1} lát): ${tree.levels} #${tree.outcome}\n   cũ    (${legacy.slices + 1} lát): ${legacy.levels} #${legacy.outcome}`);
  }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
