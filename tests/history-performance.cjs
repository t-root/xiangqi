// Measures preparation only: no engine search, network or UI paint included.
const {context,fixture,move}=require('./history-regression.cjs');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs'),path=require('node:path');
const c=context();let state=fixture(c);
const cycle=[move(9,0,8,0),move(0,8,1,8),move(8,0,9,0),move(1,8,0,8)];
const samples=[];
for(const plies of [0,4,40,120,240,500]) {
 while(state.repetitionMoves.length<plies)state=c.buildHypotheticalStateAfterMove(state,cycle[state.repetitionMoves.length%4]);
 c.board=c.cloneBoard(state.board);c.currentPlayer=state.side;c.installEngineHistory(state);
 for(let i=0;i<20;i++)c.buildEnginePositionState(c.buildCurrentEnginePositionState(),true);
 const timings=[];let command;
 for(let i=0;i<150;i++){
  const start=performance.now();command=c.buildEnginePositionState(c.buildCurrentEnginePositionState(),true).cmd;
  timings.push(performance.now()-start);
 }
 timings.sort((a,b)=>a-b);
 samples.push({plies,medianMs:+timings[75].toFixed(3),p95Ms:+timings[142].toFixed(3),commandBytes:Buffer.byteLength(command)});
}
const report={timestamp:new Date().toISOString(),node:process.version,iterations:150,
 method:'Actual UI state builder and serializer in Node VM; sparse legal rook-cycle fixture; includes copying, replay validation, check streak and cache signatures. Synthetic long histories may exceed normal game adjudication. Excludes native/WASM replay, network, search and rendering.',samples};
console.log(JSON.stringify(report,null,2));
fs.writeFileSync(path.join(__dirname,'reports/history-performance.json'),JSON.stringify(report,null,2)+'\n');
