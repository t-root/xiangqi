// "Thử nước của tôi" chỉ được kết luận giữ/mất khi đã CHỨNG MINH: Brute-force quét xong (outcome draw hoặc
// thấy mate). Hết giờ giữa chừng (partial) hay Pikafish không thấy mate đều phải ra "chưa chứng minh".
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
let source = '';
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  for (const node of parser.parse(match[1]).program.body) {
    if (node.type === 'FunctionDeclaration' && node.id.name === 'interpretTrialVerdict') source = match[1].slice(node.start, node.end);
  }
}
assert.ok(source, 'thiếu interpretTrialVerdict');
const c = vm.createContext({});
vm.runInContext(source, c);
const v = (...args) => JSON.parse(JSON.stringify(c.interpretTrialVerdict(...args)));
const mate = n => ({ scoreType: 'mate', scoreVal: n, outcomeHint: undefined });
const draw = { scoreType: 'cp', scoreVal: 0, outcomeHint: 'draw' };
const partial = { scoreType: 'cp', scoreVal: 0, outcomeHint: 'partial' };

// Bên thủ (tôi là Đen), mốc 8
assert.equal(v('bruteforce', false, 8, draw).keep, true, 'BF quét xong không có mate = giữ (đã chứng minh)');
assert.match(v('bruteforce', false, 8, draw).text, /đã chứng minh/);
assert.equal(v('bruteforce', false, 8, partial).keep, null, 'BF hết giờ giữa chừng không được kết luận giữ');
assert.equal(v('bruteforce', false, 8, null).keep, null);
assert.equal(v('pikafish', false, 8, draw).keep, null, 'Pikafish không chứng minh được "không mate"');
assert.equal(v('pikafish', false, 8, { scoreType: 'cp', scoreVal: 10 }).keep, null);
assert.equal(v('bruteforce', false, 8, mate(6)).keep, false, 'bị mate trong mốc = mất');
assert.equal(v('pikafish', false, 8, mate(6)).keep, false, 'Pikafish thấy mate vẫn là kết luận thật');
assert.equal(v('bruteforce', false, 8, mate(9)).keep, null, 'mate ngoài mốc chưa đủ để kết luận giữ');

// Bên công (tôi là Đỏ), mốc 8
assert.equal(v('bruteforce', true, 8, mate(-5)).keep, true, 'vẫn ép được mate trong mốc = giữ');
assert.equal(v('bruteforce', true, 8, mate(3)).keep, false, 'bị phản mate = mất');
assert.equal(v('bruteforce', true, 8, draw).keep, false, 'BF chứng minh không ép nổi = mất');
assert.equal(v('bruteforce', true, 8, partial).keep, null, 'hết giờ giữa chừng = chưa chứng minh');
assert.equal(v('pikafish', true, 8, partial).keep, null);

console.log('PASS thử nước chỉ kết luận khi đã chứng minh; hết giờ/Pikafish không thấy mate = chưa chứng minh');
