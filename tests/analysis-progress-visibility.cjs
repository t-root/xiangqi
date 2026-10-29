const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');

const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
let source = '', parserSource = '', telemetryHtmlSource = '', elapsedHtmlSource = '';
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration') {
            const declaration = match[1].slice(node.start, node.end);
            if (node.id.name === 'updateAnalysisProgressUI') source = declaration;
            if (node.id.name === 'parseBruteForceProgressLine') parserSource = declaration;
            if (node.id.name === 'buildBruteForceTelemetryHtml') telemetryHtmlSource = declaration;
            if (node.id.name === 'buildAnalysisElapsedHtml') elapsedHtmlSource = declaration;
        }
    }
}
assert.ok(source, 'Missing analysis progress renderer');
assert.ok(parserSource, 'Missing Brute-force progress parser');
assert.ok(telemetryHtmlSource, 'Missing Brute-force telemetry renderer');
assert.ok(elapsedHtmlSource, 'Missing analysis elapsed renderer');

const engineLines = { style: { display: 'block' } };
const c = vm.createContext({
    analysisCancelled: false,
    analysisRunning: true,
    BRAIN_LABELS: { bruteforce: 'Brute-force', pikafish: 'Pikafish' },
    fmtElapsed: ms => `${ms / 1000} giây`,
    document: { getElementById: id => id === 'analysisEngineLines' ? engineLines : { style: {} } },
    renderCompositeAnalysisProgress: () => true
});
c.telemetryOutput = null;
vm.runInContext(`${parserSource}\n${telemetryHtmlSource}\n${elapsedHtmlSource}\n${source}`, c);
const telemetry = c.parseBruteForceProgressLine(
    'info string progress level=6 nodes=259379 nps=498792 hashFillTenths=0 hashAllocatedMiB=1024 hashMaxMiB=10749 hashLevel=1 elapsedMs=520 saving=0'
);
assert.deepEqual(JSON.parse(JSON.stringify(telemetry)), {
    level: 6, nodes: 259379, nps: 498792, hashFillTenths: 0,
    hashAllocatedMiB: 1024, hashMaxMiB: 10749, hashLevel: 1, elapsedMs: 520, saving: 0
}, 'BF progress parser must preserve the telemetry key/value pairs, including zero hash fill');
const telemetryHtml = c.buildBruteForceTelemetryHtml(telemetry);
assert.match(telemetryHtml, /bảng hash 0\.0%/);
assert.match(telemetryHtml, /RAM 1\/10\.5 GiB/);

const elapsedHtml = c.buildAnalysisElapsedHtml('6.2 giây', [
    { engine: 'pikafish', elapsedMs: 6200 },
    { engine: 'bruteforce', elapsedMs: 8000, telemetry }
]);
assert.ok(
    elapsedHtml.indexOf('Pikafish:</strong> 6.2 giây') <
    elapsedHtml.indexOf('(Tổng 6.2 giây)') &&
    elapsedHtml.indexOf('(Tổng 6.2 giây)') < elapsedHtml.indexOf('259.379 nút'),
    'Total elapsed time must appear after engine timings and before Brute-force telemetry'
);
assert.match(elapsedHtml, /<\/strong> 8 giây <span[^>]*>\(Tổng 6\.2 giây\)<\/span><br><span[^>]*display: inline/);
assert.doesNotMatch(elapsedHtml, /display: block/);

c.updateAnalysisProgressUI({}, true);
assert.equal(engineLines.style.display, 'none',
    'Previous engine lines must be hidden while a new analysis is running');

engineLines.style.display = 'block';
c.analysisRunning = false;
c.updateAnalysisProgressUI({}, true);
assert.equal(engineLines.style.display, 'block',
    'Finished analysis lines must remain visible after analysis stops');

console.log('PASS BF progress telemetry parses and renders; old engine lines hide and return after analysis');
