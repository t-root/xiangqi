const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(require('node:path').join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
let source, finishSource, defenseSource, startGuideSource, holdingSource;
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  for (const n of parser.parse(m[1]).program.body) {
    if (n.type === 'FunctionDeclaration' && n.id.name === 'refineWorstCaseLineBruteForce') source = m[1].slice(n.start, n.end);
    if (n.type === 'FunctionDeclaration' && n.id.name === 'finishAnalysis') finishSource = m[1].slice(n.start, n.end);
    if (n.type === 'FunctionDeclaration' && n.id.name === 'refreshDefenseGuideMoveBruteForce') defenseSource = m[1].slice(n.start, n.end);
    if (n.type === 'FunctionDeclaration' && n.id.name === 'startGuideSession') startGuideSource = m[1].slice(n.start, n.end);
    if (n.type === 'FunctionDeclaration' && n.id.name === 'findBruteForceHoldingMove') holdingSource = m[1].slice(n.start, n.end);
  }
}
assert.ok(source, 'missing refineWorstCaseLineBruteForce fixture');
assert.ok(finishSource, 'missing finishAnalysis fixture');
assert.ok(defenseSource, 'missing refreshDefenseGuideMoveBruteForce fixture');
assert.ok(startGuideSource, 'missing startGuideSession fixture');
assert.equal(finishSource.includes('refineWorstCaseLine('), true,
  'BF analysis must build its initial proof line');
assert.match(finishSource, /let line = \(msg.line/,
  'standalone BF analysis must retain its initial PV');
assert.match(startGuideSource, /canStartUnseededBruteForceGuide/,
  'standalone BF guide must be allowed to query the engine without a cached first move');
assert.equal(defenseSource.includes('buildLineView('), false,
  'Finding one BF holding move must not reconstruct the preview line');
assert.equal(finishSource.includes('buildDrawPreviewLineBruteForce('), true,
  'BF draw analysis must build its initial preview line');
async function run(end, budget, skip = false) {
  const commands = [];
  const move = { from: {row:0,col:0}, to:{row:0,col:1} };
  const ws = {send:s=>commands.push(s)};
  const c = vm.createContext({MATE_MAX_PLY:128, worstLineToken:1, checkStreakRuleOn:false,
    detectHardwareConcurrency:()=>2, prepareBruteForceQuery:async()=>ws,
    cloneBoard:b=>Object.assign([[{},null]], {ply:b.ply||0}),
    generateLegalMoves:b=>b.ply>=end?[]:[move],
    csEncodeForProtocol:String, boardToXiangqiFen:(b,s)=>`${b.ply}/${s}`,
    buildAnalysisEnginePositionState:(board,side)=>({board,side,repetitionMoves:[]}),
    buildHypotheticalStateAfterMove:(state,move)=>({board:{ply:state.board.ply+1},side:state.side==='red'?'black':'red',repetitionMoves:[...state.repetitionMoves,move]}),
    buildEnginePositionState:state=>({positionCommand:'position fen 0/red'+(state.repetitionMoves.length?' moves '+state.repetitionMoves.map(()=>'a0b0').join(' '):'')}),
    runBruteForceGo:async()=>({moveStr:'a0b0'}), parseUciMove:()=>move,
    isKtcBudgetSkip:()=>skip, makeMoveInPlace:b=>b.ply++, otherSide:s=>s==='red'?'black':'red'});
  vm.runInContext(source,c);
  const result = await c.refineWorstCaseLineBruteForce({ply:0},'red','red',budget,{red:7,black:9},1);
  return {result,commands};
}
async function holding(side, budgets, skip = false, cancelled = false) {
  const commands=[],move={from:{row:0,col:0},to:{row:0,col:1}};
  const state={board:[[{},null]],side,budgets:{...budgets}};
  const c=vm.createContext({guideToken:1,guideActive:true,
    generateLegalMoves:()=>[move],houseRuleLossReason:()=>'',isKtcBudgetSkip:()=>skip,
    guidePrefetchBudgetsAfterAt(){throw Error('Must not use shared UI horizon in child BF proof');},
    buildHypotheticalStateAfterMove:()=>({board:[[null,{}]]}),
    buildEnginePositionState:()=>({rootCheckStreak:{red:0,black:0},positionCommand:'position fen ROOT moves a9b9'}),
    csEncodeForProtocol:String,bruteForceRemainingBudgetCommand:b=>`go budgets red ${b.red} black ${b.black}`,
    runBruteForceGo:async(ws,cmd)=>{commands.push(cmd);return {info:{outcomeHint:'draw'}};}
  });
  vm.runInContext(holdingSource,c);
  const result=await c.findBruteForceHoldingMove({send:cmd=>commands.push(cmd)},state.board,side,budgets,1,null,()=>cancelled,state);
  assert.deepEqual(state.budgets,budgets,'Do not change the cached root budget');
  return {result,commands};
}
(async()=>{
  for(const side of ['red','black'])for(const skip of [false,true]) {
    const budgets={red:2,black:3},expected={...budgets};if(!skip)expected[side]--;
    const h=await holding(side,budgets,skip);
    assert.ok(h.result,'A completed hold proof must yield its legal move');
    assert.ok(h.commands.includes(`go budgets red ${expected.red} black ${expected.black}`));
    assert.ok(h.commands.includes('position fen ROOT moves a9b9'));
  }
  const cancelled=await holding('black',{red:2,black:2},false,true);
  assert.equal(cancelled.result,null);assert.equal(cancelled.commands.length,0);
  console.log('PASS BF holding move consumes only the mover budget, preserves KTC exemption/history, and cancels safely');
  let t=await run(3,4); assert.equal(t.result.line.length,3); assert.equal(t.result.conLai.at(-1),2);
  assert.ok(t.commands.includes('setoption name CheckStreak_RootRed value 7'));
  assert.ok(t.commands.includes('position fen 0/red moves a0b0 a0b0'));
  t=await run(15,1,true); assert.equal(t.result.line.length,15);
  t=await run(2,4); assert.equal(t.result.incomplete,true);
  t=await run(5,1); assert.equal(t.result.incomplete,true);
  console.log('PASS BF proof: early mate, KTC long line, losing terminal, exhausted budget, root streak');
})().catch(e=>{console.error(e);process.exitCode=1;});
