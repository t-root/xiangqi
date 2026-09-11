const fs = require('node:fs');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(require('node:path').join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const names = new Set();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration') names.add(node.id.name);
    }
}

assert.ok(!names.has('buildCurrentGuideLine'), 'Pika must not build a speculative continuation line');
assert.ok(!html.includes('guidePikaCacheActive'), 'Pika cache must not coordinate with a speculative line builder');
assert.match(html, /function currentGuideLineEngine\(\) \{ return ''; \}/,
    'No engine may opt into live line prediction');
console.log('PASS Pika line prediction removed; Native/Web use the same live-guide model as BF');
