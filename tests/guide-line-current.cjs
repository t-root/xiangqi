const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(require('node:path').join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(match => parser.parse(match[1]).program.body
        .filter(node => node.type === 'FunctionDeclaration' && node.id.name === 'syncGuideLineToCurrentPosition')
        .map(node => match[1].slice(node.start, node.end)))[0];

const original = [{ board: 'A' }, { board: 'B' }, { board: 'C' }];
for (const engine of ['pikafish', 'pikafishweb', 'bruteforce', 'bruteforceweb']) {
    const c = vm.createContext({ guideActive: true, guideLineEngine: engine, board: 'off-line', lineViewSteps: original });
    vm.runInContext(source, c);
    c.syncGuideLineToCurrentPosition();
    assert.equal(c.lineViewSteps, original, `${engine} must preserve the analysis PV instead of predicting a new line`);
}
console.log('PASS all engines preserve the completed analysis line; live guidance queries the real board');
