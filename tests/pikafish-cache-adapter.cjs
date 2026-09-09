const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const parser=require('../engine/node_modules/@babel/parser');
const html=fs.readFileSync(require('node:path').join(__dirname,'../xiangqi-analyzer.html'),'utf8');
let source='';
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))for(const n of parser.parse(m[1]).program.body)
 if(n.type==='FunctionDeclaration'&&['prefetchBranchPikafish','prefetchBranchPikafishImpl'].includes(n.id.name))source+=m[1].slice(n.start,n.end)+'\n';
(async()=>{
 const calls=[],engineJob={activeRunId:1,lastDepth:0};
 const c=vm.createContext({
  guideLineWaiting:false,guideLineRunning:false,guidePikaCacheActive:0,setTimeout,
  cacheBudgetsRemaining:()=>3,ensureGuideEngineJob:()=>engineJob,
  logEngineStateSemantics:()=>({positionCommand:'position fen test'}),
  beginCacheAttempt:()=>600,waitCacheRetryWindow:async()=>true,
  cacheAttemptIsCurrent:()=>true,cacheRunAlive:()=>true,
  pikafishWebCacheToken:null,preparePikafishWebQuery:async()=>{},
  pikafishWebActiveHandler:null,pikafishWebSend:()=>{},markCacheAttemptDispatched:()=>{},
  keepBetterMateInfo:(_,info)=>info,
  deferCacheAttempt:(job,status,run,completed)=>calls.push({status,run,completed}),
 });
 c.pikafishWebGo=async command=>{
  assert.equal(command,'go depth 6 movetime 600','Search must stop at remaining horizon');
  c.pikafishWebActiveHandler('info depth 2 score cp 10 pv i0c0');
  return 'bestmove i0c0';
 };
 vm.runInContext(source,c);
 assert.equal(await c.prefetchBranchPikafish({state:{},budgets:{}},true,1),false);
 assert.deepEqual(calls,[{status:'INCOMPLETE',run:1,completed:true}]);
 console.log('PASS actual Pika cache adapter: early result reaches retry without ReferenceError; bounded remaining horizon');
})().catch(e=>{console.error(e);process.exitCode=1;});
