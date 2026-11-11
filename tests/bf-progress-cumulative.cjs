'use strict';
// Số nút trong "info string progress" của phiên ấm phải CỘNG DỒN qua các lát gia hạn: dòng tiến độ đầu
// tiên của lát sau phải bắt đầu từ tổng cuối của lát trước (không về 0).
//   node tests/bf-progress-cumulative.cjs <exe>
const path = require('path');
const { BfClient } = require('./bf-rewrite/bfclient.cjs');
const exe = path.resolve(process.argv[2] || 'engine/bruteforce/bruteforce.exe');
(async () => {
  const c = new BfClient(exe, {});
  await c.ready();
  c.send('position fen 9/3k5/9/9/9/9/9/4KC3/7c1/8C w - - 0 1');
  c.send('search create t');
  await c.waitFor(l => l.indexOf('search created') >= 0);
  const firsts = [], lasts = [];
  for (let i = 0; i < 3; i++) {
    const start = c.lines.length;
    c.send('search slice t budget 12 movetime 700');
    await c.waitFor(l => l.indexOf('bestmove') === 0, 60000);
    const nodes = c.lines.slice(start).filter(l => l.startsWith('info string progress ')).map(l => +/nodes=(\d+)/.exec(l)[1]);
    firsts.push(nodes[0]);
    lasts.push(nodes[nodes.length - 1]);
  }
  c.quit();
  console.log('nút đầu mỗi lát :', firsts.join(', '));
  console.log('nút cuối mỗi lát:', lasts.join(', '));
  const ok = lasts.every((n, i) => i === 0 || (firsts[i] >= lasts[i - 1] * 0.99 && n > lasts[i - 1]));
  console.log(ok ? 'PASS: cộng dồn' : 'FAIL: bộ đếm nút bị về 0 mỗi lát');
  process.exit(ok ? 0 : 1);
})();
