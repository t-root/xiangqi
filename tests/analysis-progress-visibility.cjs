const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');

const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
let source = '';
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration' && node.id.name === 'updateAnalysisProgressUI') {
            source = match[1].slice(node.start, node.end);
        }
    }
}
assert.ok(source, 'Missing analysis progress renderer');

const engineLines = { style: { display: 'block' } };
const c = vm.createContext({
    analysisCancelled: false,
    analysisRunning: true,
    document: { getElementById: id => id === 'analysisEngineLines' ? engineLines : { style: {} } },
    renderCompositeAnalysisProgress: () => true
});
vm.runInContext(source, c);
c.updateAnalysisProgressUI({}, true);
assert.equal(engineLines.style.display, 'none',
    'Previous engine lines must be hidden while a new analysis is running');

engineLines.style.display = 'block';
c.analysisRunning = false;
c.updateAnalysisProgressUI({}, true);
assert.equal(engineLines.style.display, 'block',
    'Finished analysis lines must remain visible after analysis stops');

console.log('PASS old engine lines hide during analysis and return after it finishes');
