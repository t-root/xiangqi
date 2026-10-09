const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const parser=require('../engine/node_modules/@babel/parser');
const html=fs.readFileSync(require('node:path').join(__dirname,'../xiangqi-analyzer.html'),'utf8');
let source='';
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))for(const n of parser.parse(m[1]).program.body)
 if(n.type==='FunctionDeclaration'&&['pikafishCacheBlacklistKey','pikafishCacheSearchMoves','pikafishCacheStateBlacklisted','pikafishHorizonVerdict','prefetchBranchPikafish','prefetchBranchPikafishImpl'].includes(n.id.name))source+=m[1].slice(n.start,n.end)+'\n';
(async()=>{
 const calls=[],timers=new Map(); let nextTimer=0;
 const engineJob={activeRunId:1,lastDepth:0};
 const c=vm.createContext({
  guideAttacker:'red',PIKAFISH_CACHE_STOP_GRACE_MS:1,setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  pikafishCacheBlacklist:{pikafish:new Map(),pikafishweb:new Map()},engineCacheKey:(engine,_,horizon)=>`${engine}/${horizon}`,
  cacheBudgetsRemaining:()=>3,ensureGuideEngineJob:()=>engineJob,
  logEngineStateSemantics:()=>({positionCommand:'position fen test'}),
  beginCacheAttempt:()=>600,waitCacheRetryWindow:async()=>true,
  cacheAttemptIsCurrent:()=>true,cacheRunAlive:()=>true,
  pikafishWebCacheToken:null,preparePikafishWebQuery:async()=>{},
  pikafishWebActiveHandler:null,pikafishWebSend:command=>calls.push(command),markCacheAttemptDispatched:()=>{},
  keepBetterMateInfo:(_,info)=>info,
  deferCacheAttempt:(job,status,run,completed)=>calls.push({status,run,completed}),
  finishCacheAttempt:()=>true,wakeGuideWhenCacheReady:()=>{},
  parseUciMove:()=>({from:{},to:{}}),generateLegalMoves:()=>[{}],
  rememberPrefetchedGuideMove:()=>{},seedPrefetchedSelectedLine:()=>{}
 });
 c.pikafishWebGo=async command=>{
  assert.equal(command,'go infinite','Cache search must be unbounded by depth');
  c.pikafishWebActiveHandler('info depth 2 score mate 3 pv i0c0');
  for(const fn of [...timers.values()]) fn();
  return 'bestmove i0c0';
 };
 vm.runInContext(source,c);
 assert.equal(await c.prefetchBranchPikafish({state:{side:'red',board:[]},budgets:{}},true,1),true);
 assert.deepEqual(calls,['position fen test','stop']);
 console.log('PASS Pika cache adapter: go infinite is stopped by JavaScript and mate horizon ignores search depth');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const calls=[],timers=new Map(); let nextTimer=0,listener=null;
 const ws={
  send(command){
   calls.push(command);
   if(command==='stop'&&listener) {
    listener({data:'info depth 2 score mate 3 pv i0c0'});
    listener({data:'bestmove i0c0'});
   }
  }
 };
 const engineJob={activeRunId:1,lastDepth:0};
 const c=vm.createContext({
  guideAttacker:'red',PIKAFISH_CACHE_STOP_GRACE_MS:1,setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  pikafishCacheBlacklist:{pikafish:new Map(),pikafishweb:new Map()},engineCacheKey:(engine,_,horizon)=>`${engine}/${horizon}`,
  cacheBudgetsRemaining:()=>3,ensureGuideEngineJob:()=>engineJob,
  logEngineStateSemantics:()=>({positionCommand:'position fen test'}),
  beginCacheAttempt:()=>600,waitCacheRetryWindow:async()=>true,
  cacheAttemptIsCurrent:()=>true,cacheRunAlive:()=>true,
  detectHardwareConcurrency:()=>2,pikafishNativeCacheToken:null,
  preparePikafishQuery:async()=>ws,pikafishAttachHandler:(_,handler)=>{listener=handler;},
  pikafishDetachHandler:()=>{listener=null;},markCacheAttemptDispatched:()=>{},
  keepBetterMateInfo:(_,info)=>info,finishCacheAttempt:()=>true,wakeGuideWhenCacheReady:()=>{},
  parseUciMove:()=>({from:{},to:{}}),generateLegalMoves:()=>[{}],
  rememberPrefetchedGuideMove:()=>{},seedPrefetchedSelectedLine:()=>{}
 });
 vm.runInContext(source,c);
 const pending=c.prefetchBranchPikafish({state:{side:'red',board:[]},budgets:{}},false,1);
 for(let i=0;i<4&&timers.size<2;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timers.size,2);
 const stopTimer=[...timers.values()][0];
 stopTimer();
 assert.equal(await pending,true);
 assert.deepEqual(calls,['position fen test','go infinite','stop']);
 console.log('PASS native Pika cache adapter: go infinite is stopped by JavaScript');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const calls=[],timers=[]; let listener=null;
 const ws={send:command=>calls.push(command)};
 const engineJob={activeRunId:1,lastDepth:0};
 const c=vm.createContext({
  guideAttacker:'red',PIKAFISH_CACHE_STOP_GRACE_MS:1,
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
  pikafishCacheBlacklist:{pikafish:new Map(),pikafishweb:new Map()},engineCacheKey:(engine,_,horizon)=>`${engine}/${horizon}`,
  cacheBudgetsRemaining:()=>3,ensureGuideEngineJob:()=>engineJob,
  logEngineStateSemantics:()=>({positionCommand:'position fen test'}),
  beginCacheAttempt:()=>10,waitCacheRetryWindow:async()=>true,
  cacheAttemptIsCurrent:()=>true,cacheRunAlive:()=>true,
  detectHardwareConcurrency:()=>2,pikafishNativeCacheToken:null,
  preparePikafishQuery:async()=>ws,pikafishAttachHandler:(_,handler)=>{listener=handler;},
  pikafishDetachHandler:()=>{listener=null;},markCacheAttemptDispatched:()=>{},
  keepBetterMateInfo:(_,info)=>info,finishCacheAttempt:()=>true,wakeGuideWhenCacheReady:()=>{},
  parseUciMove:()=>({from:{},to:{}}),generateLegalMoves:()=>[{}],
  rememberPrefetchedGuideMove:()=>{},seedPrefetchedSelectedLine:()=>{}
 });
 vm.runInContext(source,c);
 const pending=c.prefetchBranchPikafish({state:{side:'red',board:[]},budgets:{}},false,1);
 for(let i=0;i<4&&timers.length<2;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timers.length,2,'Cache must arm stop and a post-stop watchdog');
 for(const timer of [...timers]) timer();
 await assert.rejects(pending,/không trả bestmove sau stop/);
 assert.deepEqual(calls,['position fen test','go infinite','stop','stop']);
 assert.equal(listener,null,'Watchdog must detach the stalled native handler');
 console.log('PASS stalled native Pika cache search is released after stop watchdog');
})().catch(e=>{console.error(e);process.exitCode=1;});
