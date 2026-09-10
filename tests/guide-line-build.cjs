const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const parser=require('../engine/node_modules/@babel/parser');
const html=fs.readFileSync(require('node:path').join(__dirname,'../xiangqi-analyzer.html'),'utf8');
const functions={};
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))for(const n of parser.parse(m[1]).program.body)
 if(n.type==='FunctionDeclaration')functions[n.id.name]=m[1].slice(n.start,n.end);
function setup(end,budget){
 const updates=[],calls=[];
 const c=vm.createContext({board:0,currentPlayer:'red',boardKey:String,guideAttacker:'red',guideSide:'red',guideBestMove:null,guideLineToken:1,guideActive:true,gameOver:false,
 guideEngine:'pikafish',guideLineEngine:'pikafish',guideLineRunning:false,guideLineWaiting:false,guideLineKey:'root',guideLineTimer:null,
 linePreviewGameSnapshot:null,lineViewIndex:0,lineViewSteps:[],worstLineToken:0,BRAIN_LABELS:{},clearTimeout,
 stopBrainSearch(){},stopBackgroundCacheForLive(){throw Error('Must not clear cache');},scheduleGuideNextPlyPrefetch(){throw Error('Must not rebuild cache display');},
 generateLegalMoves:(b)=>b>=end?[]:[{id:b}],boardToXiangqiFen:(b,s)=>`${b}/${s}`,
 moveToUci:m=>String(m.id),getAnalysisTimeLimitMs:()=>5,
 querySingleEngineGuideMove:async(e,fen)=>{calls.push(fen);return {moveStr:fen.split('/')[0]};},
 guidePrefetchBudgetsAfterAt:(b,n,s)=>({red:n.red-(s==='red'?1:0),black:n.black-(s==='red'?1:0)}),
 buildHypotheticalStateAfterMove:s=>({...s,board:s.board+1,side:s.side==='red'?'black':'red'}),
 buildLineView:(b,s,line)=>{c.lineViewSteps=[{board:b},...line.map(m=>({board:m.id+1}))];},
 refreshLineViewRow:()=>updates.push(c.lineViewBuildStatus)});
 vm.runInContext(functions.cancelCurrentGuideLine+'\n'+functions.buildCurrentGuideLine,c);
 return {c,updates,calls,root:{board:0,side:'red',budgets:{red:budget,black:budget}}};
}
(async()=>{
 const reuse=vm.createContext({board:0,currentPlayer:'red',guideSide:'red',guideBestMove:null,pendingCompositeGuideChoice:null,
  guideActive:true,gameOver:false,linePreviewGameSnapshot:null,guideLineKey:'',guideLineToken:0,
  guideLineRunning:false,guideLineWaiting:false,guideLineTimer:null,guideLineEngine:'pikafish',
  guideThinking:false,analysisRunning:false,aiThinking:false,assistThinking:false,exhaustiveCacheRunning:false,
  guideAttacker:'red',guidePikaCacheActive:0,boardKey:String,currentGuideLineEngine:()=> 'pikafish',
  lastAnalysisSnapshot:0,lastAnalysisGuideSeed:{winner:'red',firstPlayer:'red',moves:[{}]},
  lineViewSteps:[{board:0},{board:1},{board:2},{board:3}],lineViewIndex:0,
  guideCurrentCacheBudgets:()=>({red:2,black:2}),guideMovesRemaining:()=>2,
  buildCurrentEnginePositionState:()=>({board:reuse.board}),engineCacheKey:(e,s)=>`${e}/${s.board}`,
  clearTimeout(){},setTimeout:fn=>{reuse.tick=fn;return 1;},stopBrainSearch(){},refreshLineViewRow(){},
  buildLineView:b=>{reuse.lineViewSteps=[{board:b}];},
  buildCurrentGuideLine:()=>{reuse.builds=(reuse.builds||0)+1;}});
 vm.runInContext(['cancelCurrentGuideLine','scheduleCurrentGuideLine','syncGuideLineToCurrentPosition',
  'reuseAnalysisGuideLine'].map(n=>functions[n]).join('\n'),reuse);
 // Use a truthy root, as real boards are arrays.
 reuse.board=10;reuse.lastAnalysisSnapshot=10;
 reuse.lineViewSteps=[{board:10},{board:11},{board:12},{board:13}];
 assert.equal(reuse.reuseAnalysisGuideLine(),true);
 reuse.scheduleCurrentGuideLine();reuse.tick();assert.equal(reuse.builds,undefined);
 for(const b of [11,12]){
  reuse.cancelCurrentGuideLine();reuse.board=b;
  reuse.syncGuideLineToCurrentPosition();reuse.scheduleCurrentGuideLine();reuse.tick();
  assert.equal(reuse.builds,undefined,'Following either side of the existing line must not search');
  assert.equal(reuse.lineViewSteps[0].board,b);
 }
 reuse.cancelCurrentGuideLine();reuse.board=99;
 reuse.syncGuideLineToCurrentPosition();reuse.scheduleCurrentGuideLine();reuse.tick();
 assert.equal(reuse.builds,1,'Leaving the line must build a new continuation');
 reuse.lineViewSteps=[{board:12},{board:13}];reuse.board=13;reuse.cancelCurrentGuideLine();
 reuse.syncGuideLineToCurrentPosition();reuse.scheduleCurrentGuideLine();reuse.tick();
 assert.equal(reuse.builds,2,'An exhausted line must allow another search');
 console.log('PASS reuse analysis root and both sides of PV; rebuild on deviation or exhausted line');
 const scheduled=vm.createContext({guideActive:true,gameOver:false,guideLineRunning:false,pendingCompositeGuideChoice:null,
  guideThinking:false,analysisRunning:false,aiThinking:false,assistThinking:false,exhaustiveCacheRunning:false,
  guideAttacker:'red',guideLineKey:'',guideLineToken:1,guidePrefetchRunning:true,guidePikaCacheActive:1,
  linePreviewGameSnapshot:null,currentGuideLineEngine:()=> 'pikafish',guideMovesRemaining:()=>2,
  guideCurrentCacheBudgets:()=>({red:2,black:2}),buildCurrentEnginePositionState:()=>({board:0}),
  engineCacheKey:()=> 'root',guideLineTimer:null,clearTimeout(){},
  setTimeout:fn=>{scheduled.tick=fn;return 1;},refreshLineViewRow(){},
  cancelCurrentGuideLine(){scheduled.guideLineKey='';},
  buildCurrentGuideLine(){scheduled.started=(scheduled.started||0)+1;}});
 vm.runInContext(functions.scheduleCurrentGuideLine,scheduled);
 scheduled.scheduleCurrentGuideLine();scheduled.tick();
 assert.equal(scheduled.started,undefined);assert.match(scheduled.lineViewBuildStatus,/chờ Pika/);
 scheduled.guidePikaCacheActive=0;scheduled.tick();
 assert.equal(scheduled.started,1,'Preview resumes when Pika is free even while BF cache remains active');
 let t=setup(3,2);await t.c.buildCurrentGuideLine(t.root,'pikafish',1);
 assert.match(t.c.lineViewBuildStatus,/kết thúc thắng/);assert.equal(t.calls.length,3);
 t=setup(9,1);await t.c.buildCurrentGuideLine(t.root,'pikafish',1);
 assert.match(t.c.lineViewBuildStatus,/chưa đến mate/);assert.equal(t.calls.length,1);
 t=setup(3,2);let release;
 t.c.querySingleEngineGuideMove=()=>new Promise(r=>release=r);
 const run=t.c.buildCurrentGuideLine(t.root,'pikafish',1),before=t.updates.length;
 t.c.cancelCurrentGuideLine();release({moveStr:'0'});await run;
 assert.equal(t.updates.length,before);assert.equal(t.c.lineViewSteps.length,1);assert.ok(!t.c.resumed);
 t=setup(3,2);t.c.querySingleEngineGuideMove=async()=>({moveStr:'illegal'});
 await t.c.buildCurrentGuideLine(t.root,'pikafish',1);assert.match(t.c.lineViewBuildStatus,/chưa hoàn tất/);
 for(const engine of ['bruteforce','bruteforceweb']){t=setup(3,2);await t.c.buildCurrentGuideLine(t.root,engine,1);assert.equal(t.calls.length,0);assert.equal(t.updates.length,0);}
 const gates=vm.createContext({guideLineWaiting:true,guideLineRunning:false,guidePikaCacheActive:0,setTimeout,
  cancelCurrentGuideLine:()=>{gates.guideLineRunning=false;gates.cancelled=true;},
  cacheRunAlive:()=>true,prefetchBranchPikafishImpl:async()=>{gates.dispatched=(gates.dispatched||0)+1;return true;}});
 vm.runInContext(functions.prefetchBranchPikafish,gates);
 assert.equal(await gates.prefetchBranchPikafish({},false,1),true);assert.equal(gates.dispatched,1);
 gates.guideLineRunning=true;
 assert.equal(await gates.prefetchBranchPikafish({},false,1),true);assert.ok(gates.cancelled);
 assert.equal(gates.dispatched,2);assert.equal(gates.guidePikaCacheActive,0);
 gates.guideLineWaiting=true;gates.cacheRunAlive=()=>false;
 assert.equal(await gates.prefetchBranchPikafish({},false,1),false);assert.equal(gates.dispatched,2);
 const choices=vm.createContext({guideEngine:'nativecombo',globalBrain:()=>'',compositeBrains:b=>({nativecombo:['bruteforce','pikafish'],webcombo:['bruteforceweb','pikafishweb']}[b]||[b])});
 vm.runInContext(functions.currentGuideLineEngine,choices);
 for(const [mode,expected] of [['nativecombo','pikafish'],['webcombo','pikafishweb'],['bruteforce',''],['bruteforceweb','']]){choices.guideEngine=mode;assert.equal(choices.currentGuideLineEngine(),expected);}
 console.log('PASS Pika-only routing: cache never waits for preview and preempts running preview');
 console.log('PASS line builder: alternating moves, terminal check, remaining budget, cancellation, illegal result');
})().catch(e=>{console.error(e);process.exitCode=1;});
