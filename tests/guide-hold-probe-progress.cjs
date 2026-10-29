// Khi Brute-force không trả nước giữ mốc, giao diện thử từng nước thủ (findBruteForceHoldingMove), mỗi nước là
// một lượt chứng minh đầy đủ. Lỗi cũ: lời gọi trong refreshDefenseGuideMoveBruteForce truyền onDepth = null nên khung
// đứng ở "độ sâu N/N", nút/RAM/hash không đổi còn đồng hồ vẫn chạy — trông như treo.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');

const functions = new Map();
let source = '';
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  const code = match[1];
  const ast = parser.parse(code, { sourceType: 'script' });
  (function walk(node) {
    if (!node || typeof node.type !== 'string') {
      if (Array.isArray(node)) node.forEach(walk);
      return;
    }
    if (node.type === 'FunctionDeclaration' && node.id) functions.set(node.id.name, code.slice(node.start, node.end));
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object') walk(child);
    }
  })(ast.program);
  source += code;
}

// 1) Lời gọi dự phòng phải truyền callback tiến độ (đối số thứ 6), không phải null.
const body = functions.get('refreshDefenseGuideMoveBruteForce');
assert.ok(body, 'thiếu refreshDefenseGuideMoveBruteForce');
const call = /findBruteForceHoldingMove\(ws, snapshot, defender,\s*isDrawProof \? liveBudgets : remaining, token,\s*([^\n]+)/.exec(body);
assert.ok(call, 'không thấy lời gọi findBruteForceHoldingMove trong nhánh dự phòng');
assert.ok(!/^null\b/.test(call[1].trim()), 'nhánh dự phòng không được truyền onDepth = null');
assert.ok(/guideBruteForceHoldProbeHtml/.test(body), 'nhánh dự phòng phải dựng khung tiến độ bằng guideBruteForceHoldProbeHtml');

// 2) Khung tiến độ hiện nhánh k/N, độ sâu, mốc, telemetry và giữ marker đồng hồ.
const render = functions.get('guideBruteForceHoldProbeHtml');
assert.ok(render, 'thiếu guideBruteForceHoldProbeHtml');
const fn = new Function('buildBruteForceTelemetryHtml', render + '; return guideBruteForceHoldProbeHtml;')(
  (t, showEmpty) => t ? `<stats nodes=${t.nodes}>` : (showEmpty ? '<stats empty>' : ''));
const text = fn('Brute-force', 3, 17, 9, 9, { nodes: 123 });
assert.match(text, /nhánh 3\/17/);
assert.match(text, /độ sâu 9\/9/);
assert.match(text, /<!--elapsed-->/);
assert.match(text, /<stats nodes=123>/);
assert.match(fn('Brute-force', 1, 17, 0, 9, null), /đang chứng minh mốc 9 nước/);
// 3) Dòng nút/RAM/hash luôn hiện ở khung dò Đỏ lẫn Đen, kể cả trước khi có số liệu đầu tiên.
assert.match(fn('Brute-force', 1, 17, 0, 9, null), /<stats empty>/);
const progress = functions.get('guideBruteForceProgressHtml');
assert.ok(progress, 'thiếu guideBruteForceProgressHtml');
const progressFn = new Function('buildBruteForceTelemetryHtml', progress + '; return guideBruteForceProgressHtml;')(
  (t, showEmpty) => t ? `<stats nodes=${t.nodes}>` : (showEmpty ? '<stats empty>' : ''));
assert.match(progressFn('Brute-force', 0, 9, null), /<stats empty>/);
assert.match(progressFn('Brute-force', 4, 9, { nodes: 5 }), /<stats nodes=5>/);
for (const name of ['refreshWinGuideMoveBruteForce', 'refreshDefenseGuideMoveBruteForce']) {
  assert.ok(!/đang dò thẳng nhánh này(...| — độ sâu 0)/.test(functions.get(name)), name + ': khung khởi đầu phải dùng guideBruteForceProgressHtml để có dòng nút/RAM/hash');
}
console.log('PASS vòng thử nước giữ mốc có tiến độ nhánh/độ sâu/telemetry');
