const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');

const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const functions = new Map();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration') {
            functions.set(node.id.name, match[1].slice(node.start, node.end));
        }
    }
}

assert.ok(functions.has('getAnalysisEngineThreadCount'));
assert.ok(functions.has('getGameplayEngineThreadCount'));
const context = vm.createContext({});
vm.runInContext(functions.get('getAnalysisEngineThreadCount'), context);
vm.runInContext(functions.get('getGameplayEngineThreadCount'), context);
assert.equal(context.getAnalysisEngineThreadCount(), 1);
assert.equal(context.getGameplayEngineThreadCount(), 2);

const analysisFunctions = [
    'probePikafishAnalysis', 'probeBruteForceAnalysis', 'buildDrawPreviewLineBruteForce',
    'refineWorstCaseLineBruteForce', 'prefetchBranchBruteForce', 'prefetchBranchPikafishImpl',
    'pikafishFullPotentialMoves', 'startAnalysisBruteForce', 'runPikafishAnalysisQuery'
];
for (const name of analysisFunctions) {
    assert.ok(functions.has(name), `Missing analysis function ${name}`);
    assert.match(functions.get(name), /getAnalysisEngineThreadCount\(\)/,
        `${name} must configure analysis engines to one thread`);
}

const gameplayFunctions = [
    'aiPlayTurnPikafish', 'playAiMoveForMePikafish', 'tryBruteForceBeforeEngineWeb',
    'refreshMateGuideMovePikafish', 'refreshDrawProofGuideMovePikafish',
    'refreshWinGuideMovePikafish', 'refreshDefenseGuideMoveBruteForce',
    'refreshPlayGuideMovePikafish', 'queryPikafishNativeMove', 'querySingleEngineMove',
    'querySingleEngineGuideMove', 'aiPlayTurnBruteForce', 'playAiMoveForMeBruteForce',
    'refreshWinGuideMoveBruteForce', 'refreshPlayGuideMoveBruteForce'
];
for (const name of gameplayFunctions) {
    assert.ok(functions.has(name), `Missing gameplay function ${name}`);
    assert.match(functions.get(name), /getGameplayEngineThreadCount\(\)/,
        `${name} must configure gameplay engines to two threads`);
}

assert.match(functions.get('preparePikafishWebQuery'),
    /threads = getGameplayEngineThreadCount\(\)/,
    'Pikafish Web gameplay callers default to two threads');
assert.doesNotMatch(html, /getEngineThreadCount|configureEngineThreads|engineThreadSetup|assistThreadSetup/,
    'the obsolete user-configurable thread control must be removed');

console.log('PASS engine thread policy: analysis uses one thread; gameplay uses two per engine');
