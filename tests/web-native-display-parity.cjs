const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(require('node:path').join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const functions = {};
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration') functions[node.id.name] = match[1].slice(node.start, node.end);
    }
}

assert.ok(functions.finishPikafishAnalysisResult, 'Pikafish result renderer must be shared');
assert.match(functions.finishPikafishAnalysis, /finishPikafishAnalysisResult\('pikafish'/);
assert.match(functions.finishPikafishWebAnalysis, /finishPikafishAnalysisResult\('pikafishweb'/);
assert.ok(functions.startAnalysisComposite, 'Native and Web composite must share one display flow');

const c = vm.createContext({
    MATE_SCORE: 100000, analysisDepthRed: 3, analysisDepthBlack: 3, analysisDepthReached: 6,
    engineAnalysisPreviewLine: () => [{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }],
    finishAnalysis: msg => { c.messages.push(msg); }, messages: []
});
vm.runInContext([functions.finishPikafishAnalysisResult, functions.finishPikafishAnalysis,
    functions.finishPikafishWebAnalysis].join('\n'), c);
const info = { scoreType: 'mate', scoreVal: 2, depth: 6 };
c.finishPikafishAnalysis(info, { board: [] }, {});
c.finishPikafishWebAnalysis(info, { board: [] }, {});
const [native, web] = c.messages;
assert.deepEqual({ ...native, engine: '' }, { ...web, engine: '' }, 'Web and Native result data must match');
assert.equal(native.engine, 'pikafish');
assert.equal(web.engine, 'pikafishweb');
console.log('PASS Native/Web result display uses one renderer; composite uses one display flow');
