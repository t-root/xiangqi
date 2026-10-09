const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const functions = new Map();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  const text = match[1];
  for (const node of parser.parse(text).program.body) {
    if (node.type === 'FunctionDeclaration') functions.set(node.id.name, text.slice(node.start, node.end));
  }
}
function load(context, names) {
  vm.createContext(context);
  for (const name of names) vm.runInContext(functions.get(name), context);
  return context;
}
const labels = {nativecombo:'Phối hợp Native',webcombo:'Phối hợp Web',pikafish:'Pikafish',bruteforce:'Brute-force',pikafishweb:'Pikafish Web',bruteforceweb:'Brute-force Web'};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
 for (const combo of ['nativecombo', 'webcombo']) {
  await test(combo+': cache queues advance independently, retry alone and cancel without dispatching more',async()=>{
   const calls=[], pending=new Map(); let alive=true;
   const jobs=[1,2,3].map(index=>({index,state:{board:[],side:'red'},budgets:{},engineJobs:{}}));
   const c=load({guideAwaitedCacheKey:'',setTimeout,MAX_ENGINE_MOVETIME_MS:2147483647,
    cacheAttemptFinished:j=>j?.status==='READY',cacheAttemptTerminalFailure:j=>j?.status==='PROVEN_FAIL',
    captureCacheRunIds:()=>({}),cacheInitialTimeMsForEngine:()=>10,
    withCompositeEngineDeadline:(_,p)=>p,generateLegalMoves:()=>[{}],hasVerifiedGuideHorizonCache:()=>false,
    deferThrownCacheAttempts:(job,brain)=>{job.engineJobs[brain].status='INCOMPLETE';},
    prefetchBranchForBrain:(job,brain)=>{
     calls.push(`${brain}:${job.index}`); const d=deferred(); pending.set(`${brain}:${job.index}`,d);
     job.engineJobs[brain]={status:'RUNNING'};
     return d.promise.then(value=>{job.engineJobs[brain].status=value?'READY':'INCOMPLETE';return value;});
    }
   },['compositeBrains','cachePrefetchDeadlineMs','cacheJobNextAttempt','takeFullCacheJob','prefetchIndependentCacheQueues']);
   const [fast,slow]=c.compositeBrains(combo);
   const run=c.prefetchIndependentCacheQueues(jobs,[fast,slow],1,()=>alive,()=>{});
   assert.deepEqual(calls,[`${fast}:1`,`${slow}:1`]);
   pending.get(`${fast}:1`).resolve(true); await tick();
   assert(calls.includes(`${fast}:2`));assert(!calls.includes(`${slow}:2`));
   pending.get(`${fast}:2`).reject(Error('retry'));await tick();
   assert(calls.includes(`${fast}:3`));
   pending.get(`${fast}:3`).resolve(true);
   await new Promise(r=>setTimeout(r,15));
   assert.equal(calls.filter(x=>x===`${fast}:2`).length,2);
   assert.equal(calls.filter(x=>x===`${fast}:1`).length,1);
   pending.get(`${fast}:2`).resolve(true);await tick();
   alive=false;pending.get(`${slow}:1`).resolve(true);await run;
   assert(!calls.includes(`${slow}:2`));
  });
 }
 await test('live router uses the composite path in all five guide modes, native and web',()=>{
  const calls=[];
  const c=load({guideActive:true,document:{getElementById:()=>({})},guideToken:0,guideSide:'black',currentPlayer:'black',
   gameOver:false,guideAttacker:'red',guideMovesTarget:6,guideMaxMoves:6,board:[],BRAIN_IDS:Object.keys(labels),
   syncCheckStreakRestrictedForGame(){},prioritizeFullCacheCurrentBranch(){},fullCacheConstrained:()=>false,
   guideMovesRemaining:()=>6,recallAnalysisSeedMove:()=>null,currentCompletedGuideAnswer:()=>null,
   stopBackgroundCacheForLive(){},pendingGuideEngineJob:()=>null,
   refreshPlayGuideMoveComposite:brain=>calls.push(brain)},['refreshGuide']);
  for(const brain of ['nativecombo','webcombo'])for(const mode of ['win','defense','hold','drawproof','play']){
   c.guideEngine=brain;c.guideMode=mode;c.refreshGuide();assert.equal(calls.at(-1),brain);
  }
  assert.equal(calls.length,10);
 });
 for(const combo of ['nativecombo','webcombo']) {
  await test(combo+': both start before either finishes; early result keeps peer running',async()=>{
   const pending={},calls=[],progress={},offers=[];
   const c=load({guideToken:10,guideActive:true,BRAIN_LABELS:labels,guideMovesStatusText:()=>'',
    guideCurrentCacheBudgets:()=>({red:6,black:6}),buildCurrentEnginePositionState:b=>({board:[],budgets:b}),
    getAnalysisTimeLimitMs:()=>1200,withCompositeEngineDeadline:(_,p)=>p,
    querySingleEngineGuideMove:(brain,fen,color,time,budget,onInfo)=>{
     calls.push({brain,time});pending[brain]=deferred();onInfo({depth:brain.startsWith('pika')?12:3});return pending[brain].promise;
    }},['compositeBrains','queryCompositeGuideCandidates','compositeGuideThinkingHtml']);
   const parts=c.compositeBrains(combo);
   const promise=c.queryCompositeGuideCandidates(combo,'fen','red',6,()=>true,(b,i)=>progress[b]=i,a=>offers.push(a),[]);
   assert.equal(calls.length,2);assert.equal(calls[1].time,null);
   pending[parts[0]].resolve({moveStr:'a0a1',info:{depth:20,scoreType:'mate',scoreVal:6}});await tick();
   assert.equal(offers.length,1);assert.equal(progress[parts[0]].engineStatus,'ready');assert.equal(progress[parts[1]].engineStatus,'running');
   const display=c.compositeGuideThinkingHtml(combo,'attack',6,progress);
   assert(display.includes('20 nửa nước'));assert(display.includes('3/6 nước/bên'));
   pending[parts[1]].resolve({moveStr:'b0b1',info:{depth:6,scoreType:'mate',scoreVal:6}});
   assert.equal((await promise).length,2);assert.equal(progress[parts[1]].engineStatus,'ready');
  });
  await test(combo+': failure stays visible while peer completes; stale results are ignored',async()=>{
   const pending={},progress={},offers=[];
   const c=load({guideToken:1,guideActive:true,guideCurrentCacheBudgets:()=>({}),buildCurrentEnginePositionState:()=>({}),
    getAnalysisTimeLimitMs:()=>10,withCompositeEngineDeadline:(_,p)=>p,
    querySingleEngineGuideMove:brain=>{pending[brain]=deferred();return pending[brain].promise;}},['compositeBrains','queryCompositeGuideCandidates']);
   const parts=c.compositeBrains(combo);
   const run=c.queryCompositeGuideCandidates(combo,'fen','red',6,()=>true,(b,i)=>progress[b]=i,a=>offers.push(a));
   pending[parts[0]].reject(Error('offline'));await tick();assert.equal(progress[parts[0]].engineStatus,'error');
   c.guideToken++;pending[parts[1]].resolve({moveStr:'a0a1'});assert.equal((await run).length,0);assert.equal(offers.length,0);
  });
 }
 await test('BF live adapters use no movetime and preserve asymmetric draw budgets',async()=>{
  for(const brain of ['bruteforce','bruteforceweb']) {
   const commands=[];let holdingBudget;
   const socket={send:s=>commands.push(s)};
   const c=load({detectHardwareConcurrency:()=>4,buildEnginePositionState:()=>({positionCommand:'position fen snapshot',rootCheckStreak:{}}),
    prepareBruteForceWebQuery:async()=>socket,prepareBruteForceQuery:async()=>socket,guideToken:1,
    bruteForceRemainingBudgetCommand:b=>`go budgets red ${b.red} black ${b.black}`,
    runBruteForceGo:async(_,cmd)=>{commands.push(cmd);return {info:{outcomeHint:'draw'}};},
    findBruteForceHoldingMove:async(_,__,___,b)=>{holdingBudget=b;return {};},cloneBoard:b=>b,moveToUci:()=> 'a0a1'
   },['querySingleEngineGuideMove']);
   const budgets={red:5,black:6};
   const res=await c.querySingleEngineGuideMove(brain,'fen','red',null,6,null,[],true,{},()=>true,budgets);
   assert.equal(commands[1],'go budgets red 5 black 6');assert.equal(holdingBudget,budgets);assert.equal(res.moveStr,'a0a1');
   commands.length=0;await c.querySingleEngineGuideMove(brain,'fen','red',null,6,null,[],true,{},()=>false);
   assert.equal(commands.length,0);
  }
 });
 console.log(`PASS ${checks} composite regression groups`);
})().catch(e=>{console.error(e);process.exitCode=1;});
