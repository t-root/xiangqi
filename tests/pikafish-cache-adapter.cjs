const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const parser=require('../engine/node_modules/@babel/parser');
const html=fs.readFileSync(require('node:path').join(__dirname,'../xiangqi-analyzer.html'),'utf8');
let source='';
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))for(const n of parser.parse(m[1]).program.body)
 if(n.type==='FunctionDeclaration'&&['pikafishCacheBlacklistKey','pikafishCacheSearchMoves','pikafishCacheStateBlacklisted','pikafishHorizonVerdict','prefetchBranchPikafish','prefetchBranchPikafishImpl'].includes(n.id.name))source+=m[1].slice(n.start,n.end)+'\n';
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
  pikafishCacheBlacklist:{pikafish:new Map()},engineCacheKey:(engine,_,horizon)=>`${engine}/${horizon}`,
  cacheBudgetsRemaining:()=>3,ensureGuideEngineJob:()=>engineJob,
  logEngineStateSemantics:()=>({positionCommand:'position fen test'}),
  beginCacheAttempt:()=>600,waitCacheRetryWindow:async()=>true,
  cacheAttemptIsCurrent:()=>true,cacheRunAlive:()=>true,
  getAnalysisEngineThreadCount:()=>1,pikafishCacheToken:null,
  preparePikafishQuery:async()=>ws,pikafishAttachHandler:(_,handler)=>{listener=handler;},
  pikafishDetachHandler:()=>{listener=null;},markCacheAttemptDispatched:()=>{},
  keepBetterMateInfo:(_,info)=>info,finishCacheAttempt:()=>true,wakeGuideWhenCacheReady:()=>{},
  parseUciMove:()=>({from:{},to:{}}),generateLegalMoves:()=>[{}],
  rememberPrefetchedGuideMove:()=>{},seedPrefetchedSelectedLine:()=>{}
 });
 vm.runInContext(source,c);
 const pending=c.prefetchBranchPikafish({state:{side:'red',board:[]},budgets:{}},1);
 for(let i=0;i<4&&timers.size<2;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timers.size,2);
 const stopTimer=[...timers.values()][0];
 stopTimer();
 assert.equal(await pending,true);
 assert.deepEqual(calls,['position fen test','go infinite','stop']);
 console.log('PASS Pika cache adapter: go infinite is stopped by JavaScript');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const calls=[],timers=[]; let listener=null;
 const ws={send:command=>calls.push(command)};
 const engineJob={activeRunId:1,lastDepth:0};
 const c=vm.createContext({
  guideAttacker:'red',PIKAFISH_CACHE_STOP_GRACE_MS:1,
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
  pikafishCacheBlacklist:{pikafish:new Map()},engineCacheKey:(engine,_,horizon)=>`${engine}/${horizon}`,
  cacheBudgetsRemaining:()=>3,ensureGuideEngineJob:()=>engineJob,
  logEngineStateSemantics:()=>({positionCommand:'position fen test'}),
  beginCacheAttempt:()=>10,waitCacheRetryWindow:async()=>true,
  cacheAttemptIsCurrent:()=>true,cacheRunAlive:()=>true,
  getAnalysisEngineThreadCount:()=>1,pikafishCacheToken:null,
  preparePikafishQuery:async()=>ws,pikafishAttachHandler:(_,handler)=>{listener=handler;},
  pikafishDetachHandler:()=>{listener=null;},markCacheAttemptDispatched:()=>{},
  keepBetterMateInfo:(_,info)=>info,finishCacheAttempt:()=>true,wakeGuideWhenCacheReady:()=>{},
  parseUciMove:()=>({from:{},to:{}}),generateLegalMoves:()=>[{}],
  rememberPrefetchedGuideMove:()=>{},seedPrefetchedSelectedLine:()=>{}
 });
 vm.runInContext(source,c);
 const pending=c.prefetchBranchPikafish({state:{side:'red',board:[]},budgets:{}},1);
 for(let i=0;i<4&&timers.length<2;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timers.length,2,'Cache must arm stop and a post-stop watchdog');
 for(const timer of [...timers]) timer();
 await assert.rejects(pending,/không trả bestmove sau stop/);
 assert.deepEqual(calls,['position fen test','go infinite','stop','stop']);
 assert.equal(listener,null,'Watchdog must detach the stalled handler');
 console.log('PASS stalled Pika cache search is released after stop watchdog');
})().catch(e=>{console.error(e);process.exitCode=1;});
