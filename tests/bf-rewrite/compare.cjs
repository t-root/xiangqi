'use strict';
// So hai kết quả corpus-run: điểm/độ dài mate từng mức và kết luận cuối phải GIỐNG HỆT; in tổng
// số node và thời gian của mỗi bên. Nước đi/PV có thể khác (nhiều đường mate bằng nhau) nên không so.
//   node tests/bf-rewrite/compare.cjs <ref.jsonl> <cand.jsonl>
const fs = require('fs');
const load = f => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const ref = load(process.argv[2]), cand = load(process.argv[3]);
let mismatches = 0, errors = 0, refNodes = 0, candNodes = 0, refMs = 0, candMs = 0, refEng = 0, candEng = 0, mates = 0, compared = 0;
for (let i = 0; i < ref.length; i++) {
  const a = ref[i], b = cand[i];
  if (!b || a.fen !== b.fen) { console.log('LỆCH THỨ TỰ tại', i); mismatches++; continue; }
  if (a.error || b.error) { errors++; console.log('LỖI', a.fen, a.error || '', b.error || ''); continue; }
  const sig = r => r.levels.map(l => `${l.depth}:${l.type}:${l.val}:${l.pv.length}`).join('|') + '#' + r.outcome;
  compared++;
  if (sig(a) !== sig(b)) {
    mismatches++;
    console.log('KHÁC', a.fen, '\n  ref :', sig(a), '\n  cand:', sig(b));
  }
  if (a.levels.some(l => l.type === 'mate')) mates++;
  refNodes += a.nodes; candNodes += b.nodes; refMs += a.ms; candMs += b.ms; refEng += a.engMs || 0; candEng += b.engMs || 0;
}
console.log(`so sánh ${compared} thế (${mates} thế có mate), khác ${mismatches}, lỗi ${errors}`);
console.log(`node: ref ${refNodes}  cand ${candNodes}  tỉ lệ ${(candNodes / refNodes).toFixed(3)}`);
console.log(`ms  : ref ${refMs}  cand ${candMs}  tỉ lệ ${(candMs / refMs).toFixed(3)}`);
if (refEng) console.log(`ms engine (không tính khởi động tiến trình): ref ${refEng}  cand ${candEng}  tỉ lệ ${(candEng / refEng).toFixed(3)}`);
process.exit(mismatches ? 1 : 0);
