'use strict';
// Bộ đối chiếu: chạy bản tham chiếu và bản thử (bật RetainedTree) trên nhiều kho thế và bộ luật,
// rồi so điểm/độ dài mate từng mức (phải giống hệt). Kết quả tham chiếu được giữ trong out/ để lần sau
// không chạy lại.
//   node tests/bf-rewrite/diff-suite.cjs <candidate.exe> [tên cấu hình...]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const ref = path.join(root, 'tests', 'binaries', 'bruteforce.reference.exe');
const cand = path.resolve(process.argv[2] || path.join(root, 'tests', 'binaries', 'bruteforce.tree.exe'));
const only = process.argv.slice(3);
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const A = 'positions-a.txt', B = 'positions-b.txt', C = 'positions-c.txt', D = 'positions-d.txt';
const configs = [
  { name: 'a-none-b4', file: A, budget: 4, env: {} },
  { name: 'b-none-b3', file: B, budget: 3, env: {} },
  { name: 'a-both3-b4', file: A, budget: 4, env: { BF_RESTRICTED: 'both', BF_LIMIT: '3' } },
  { name: 'a-white2-b4', file: A, budget: 4, env: { BF_RESTRICTED: 'white', BF_LIMIT: '2' } },
  { name: 'a-black2-b4', file: A, budget: 4, env: { BF_RESTRICTED: 'black', BF_LIMIT: '2' } },
  { name: 'a-ktc-b4', file: A, budget: 4, env: { BF_KTC: '1', BF_RESTRICTED: 'white', BF_LIMIT: '2' } },
  { name: 'c-none-b5', file: C, budget: 5, env: {} },
  { name: 'c-both3-b5', file: C, budget: 5, env: { BF_RESTRICTED: 'both', BF_LIMIT: '3' } },
  { name: 'd-none-b4', file: D, budget: 4, env: {} },
  { name: 'd-both3-b4', file: D, budget: 4, env: { BF_RESTRICTED: 'both', BF_LIMIT: '3' } },
];

function run(exe, cfg, outFile, extraEnv) {
  const posFile = path.join(__dirname, cfg.file);
  if (!fs.existsSync(posFile)) return false;
  const env = Object.assign({}, process.env, cfg.env, extraEnv || {});
  const r = spawnSync(process.execPath, [path.join(__dirname, 'corpus-run.cjs'), exe, posFile, outFile,
    String(cfg.budget), '60000'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  return r.status === 0;
}

let failed = 0;
for (const cfg of configs) {
  if (only.length && !only.includes(cfg.name)) continue;
  const refOut = path.join(outDir, cfg.name + '.ref.jsonl');
  const candOut = path.join(outDir, cfg.name + '.cand.jsonl');
  if (!fs.existsSync(refOut) && !run(ref, cfg, refOut)) { console.log(`[${cfg.name}] bỏ qua (thiếu kho thế)`); continue; }
  run(cand, cfg, candOut, { BF_EXTRA: 'setoption name RetainedTree value true' });
  const cmp = spawnSync(process.execPath, [path.join(__dirname, 'compare.cjs'), refOut, candOut], { encoding: 'utf8' });
  const tail = cmp.stdout.trim().split('\n').slice(-3).join('\n');
  console.log(`[${cfg.name}] ${cmp.status === 0 ? 'OK' : 'KHÁC'}\n${cmp.status === 0 ? tail : cmp.stdout.trim().split('\n').slice(0, 20).join('\n')}`);
  if (cmp.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
