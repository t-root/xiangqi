const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const functions = new Map();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  for (const node of parser.parse(match[1]).program.body) {
    if (node.type === 'FunctionDeclaration') functions.set(node.id.name, match[1].slice(node.start, node.end));
  }
}
function context() {
  const c = vm.createContext({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval,
    board: [], positionHistory: [], gameMode: true, gameUsesAnalysisRule:false, currentPlayer: 'red', liveCheckStreak: {red:0,black:0},
    repBaseBoard:null,repBaseSideToMove:null,repBaseCheckStreak:{red:0,black:0},movesSinceCapture:[],
    lastAnalysisPositionState:null,isPlaybackActive:false,playbackLineMoves:[],playbackIndex:0,
    redMovesPlayed:0,blackMovesPlayed:0,gameHistory:[],lastMoveHighlight:null,gameOver:false,gameResult:null,
    lastEndReason:null,guideMovesUsed:0,guideMovesTarget:0,selectedSquare:null,legalDestinationsForSelected:[],
    analysisCancelled:false,onEngineSpeed(){},
    XIANGQI_FEN_LETTER:{chariot:'r',horse:'n',elephant:'b',advisor:'a',king:'k',cannon:'c',soldier:'p'},
    ENGINE_BUILD_SIGNATURES:{},
  });
  for(const match of html.matchAll(/\/\*#ENGINE-START\*\/([\s\S]*?)\/\*#ENGINE-END\*\//g)) vm.runInContext(match[1],c);
  for(const source of functions.values()) vm.runInContext(source,c);
  vm.runInContext('checkStreakRestrictedColor = "both";',c);
  return c;
}
function fixture(c) {
  const b = Array.from({length:10},()=>Array(9).fill(null));
  b[9][4]={type:'king',color:'red'}; b[0][3]={type:'king',color:'black'};
  b[9][0]={type:'chariot',color:'red'}; b[0][8]={type:'chariot',color:'black'};
  b[7][0]={type:'soldier',color:'black'};
  c.board=b;c.resetRepetitionWindow();
  return c.buildCurrentEnginePositionState();
}
const move=(r,c,rr,cc)=>({from:{row:r,col:c},to:{row:rr,col:cc}});
const a=move(9,0,8,0),b=move(0,8,1,8),capture=move(8,0,7,0),reply=move(1,8,2,8);
let groups=0;
function test(name,fn){fn();console.log('PASS '+name);groups++;}
async function asyncTest(name,fn){await fn();console.log('PASS '+name);groups++;}
module.exports={context,fixture,move};
if(require.main===module)(async()=>{
 test('full history survives a capture and hypothetical branches do not mutate the parent',()=>{
  const c=context(),root=fixture(c);let s=root;
  for(const m of [a,b,capture,reply])s=c.buildHypotheticalStateAfterMove(s,m);
  assert.equal(root.repetitionMoves.length,0);assert.equal(s.repetitionMoves.length,4);
  assert.equal(c.buildEnginePositionState(s,true).cmd,'position fen '+c.boardToXiangqiFen(root.board,'red')+' moves a0a1 i9i8 a1a2 i8i7');
  c.board=c.cloneBoard(s.board);c.currentPlayer=s.side;c.installEngineHistory(s);
  assert.equal(c.buildEnginePositionState(c.buildCurrentEnginePositionState(),false).cmd,c.buildEnginePositionState(s,false).cmd);
  assert.equal(c.positionHistory.length,2,'UI draw clock still starts after capture');
 });
 test('undo/redo restores complete provenance and cache distinguishes identical boards with different histories',()=>{
  const c=context();let s=fixture(c);const rootKey=c.engineCacheKey('pikafish',s,'test');
  for(const m of [a,b,move(8,0,9,0),move(1,8,0,8)])s=c.buildHypotheticalStateAfterMove(s,m);
  assert.notEqual(c.engineCacheKey('pikafish',s,'test'),rootKey);
  c.board=c.cloneBoard(s.board);c.currentPlayer=s.side;c.installEngineHistory(s);
  const snap=c.snapshotGameState();const next=c.buildHypotheticalStateAfterMove(s,a);
  c.board=next.board;c.currentPlayer=next.side;c.installEngineHistory(next);const redo=c.snapshotGameState();
  c.restoreGameState(snap);assert.equal(c.buildCurrentEnginePositionState().repetitionMoves.length,4);
  c.restoreGameState(redo);assert.equal(c.buildCurrentEnginePositionState().repetitionMoves.length,5);
 });
 test('playback continuation preserves pre-analysis history, capture and selected prefix only',()=>{
  const c=context();let s=fixture(c);for(const m of [a,b])s=c.buildHypotheticalStateAfterMove(s,m);
  c.lastAnalysisPositionState=c.cloneEnginePositionState(s);
  c.playbackLineMoves=[{boardState:c.cloneBoard(s.board),activePlayer:s.side}];
  for(const m of [capture,reply]){s=c.buildHypotheticalStateAfterMove(s,m);c.playbackLineMoves.push({boardState:c.cloneBoard(s.board),activePlayer:s.side});}
  const prefix=c.buildPlaybackEnginePositionState(1);
  assert.equal(prefix.repetitionMoves.length,3);assert.equal(c.buildPlaybackEnginePositionState(2).repetitionMoves.length,4);
  c.board=prefix.board;c.currentPlayer=prefix.side;c.installEngineHistory(prefix);
  assert.equal(c.buildCurrentEnginePositionState().repetitionMoves.length,3);
  c.isPlaybackActive=true;c.playbackIndex=1;
  assert.equal(c.buildAnalysisEnginePositionState(prefix.board,prefix.side).repetitionMoves.length,3);
 });
 test('invalid replay refuses dispatch; stale counters can be rebuilt without discarding moves',()=>{
  const c=context();let s=fixture(c);s=c.buildHypotheticalStateAfterMove(s,a);
  const broken=c.cloneEnginePositionState(s);broken.repetitionMoves=[];
  assert.throws(()=>c.buildEnginePositionState(broken),/Lịch sử/);
  assert.throws(()=>c.rebuildEngineHistory(broken),/Lịch sử/);
  s.checkStreak.red=99;s.cs.red=99;
  const repaired=c.rebuildEngineHistory(s);assert.equal(repaired.checkStreak.red,0);assert.equal(repaired.repetitionMoves.length,1);
  assert.throws(()=>c.enginePositionPlan('unknown fen',true),/Thiếu lịch sử/);
 });
 test('Pikafish replay seed and current-board validation use different check streaks',()=>{
  const c=context();let s=fixture(c);
  c.csAdvanceAfterMove=(_b,code)=>code+1;
  s=c.buildHypotheticalStateAfterMove(s,a);
  const pika=c.buildEnginePositionState(s,true),bf=c.buildEnginePositionState(s,false);
  assert.equal(pika.rootCheckStreak.red,0);assert.equal(pika.currentCheckStreak.red,1);assert.equal(bf.rootCheckStreak.red,1);
 });
 for(const web of [false,true])await asyncTest(`Pikafish ${web?'Web':'Native'} evaluation sends full history before go`,async()=>{
  const c=context();let s=fixture(c);for(const m of [a,b,capture])s=c.buildHypotheticalStateAfterMove(s,m);
  c.board=s.board;c.currentPlayer=s.side;c.installEngineHistory(s);
  const commands=[],ws={send:x=>commands.push(x)};
  Object.assign(c,{evalAnalysisToken:1,document:{getElementById:()=>({})},detectHardwareConcurrency:()=>2,
   preparePikafishQuery:async()=>ws,preparePikafishWebQuery:async()=>{},pikafishAttachHandler(){},
   pikafishWebSend:x=>commands.push(x),pikafishWebGo:x=>{commands.push(x);return new Promise(()=>{});}});
  await c[web?'startEvalAnalysisPikafishWeb':'startEvalAnalysisPikafish']({board:s.board,firstPlayer:s.side},10);
  assert.match(commands[0],/ moves a0a1 i9i8 a1a2$/);assert.match(commands[1],/^go /);
 });
 test('all raw position construction is confined to the common serializer',()=>{
  for(const [name,source] of functions)if(/['"]position fen /.test(source))assert.equal(name,'buildEnginePositionState');
  assert(!functions.get('executeMove').includes('movesSinceCapture = []'));
  assert(!functions.get('buildHypotheticalStateAfterMove').includes('next.repetitionMoves = []'));
 });
 console.log(`PASS ${groups} history regression groups`);
})().catch(e=>{console.error(e);process.exitCode=1;});
