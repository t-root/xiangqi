window.addEventListener('DOMContentLoaded', async () => {
 const report=document.createElement('pre'); document.body.prepend(report);
 report.id='line-test-result'; report.textContent='RUNNING line';
 const mode=new URLSearchParams(location.search).get('engine') || 'pikafish';
 const engine=mode==='nativecombo'?'pikafish':mode==='webcombo'?'pikafishweb':mode;
 try {
  const parsed=parseXiangqiFen('9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1');
  board=parsed.board;currentPlayer='red';guideSide='red';guideAttacker='red';guideEngine=mode;
  guideActive=true;guideMode='win';guideMovesTarget=4;guideMaxMoves=4;guideMovesUsed=0;gameOver=false;
  const defense=new URLSearchParams(location.search).has('defense');
  if(defense){makeMoveInPlace(board,generateLegalMoves(board,'red').find(m=>moveToUci(m)==='a0a4'));currentPlayer='black';guideSide='black';guideMovesUsed=1;}
  if(engine.startsWith('bruteforce')) {
   scheduleCurrentGuideLine();refreshLineViewRow();
   if(guideLineTimer || guideLineRunning || document.getElementById('guideLineControls').style.display!=='none')throw Error('BF line should be disabled');
   report.textContent='PASS '+mode+' line feature disabled';return;
  }
  getAnalysisTimeLimitMs=()=>engine.startsWith('bruteforce') ? 15000 : 1500;
  const traces=[],query=querySingleEngineGuideMove;
  querySingleEngineGuideMove=async function(...args){const r=await query(...args);if(engine.startsWith('pikafish') && r.info?.pv)r.info.pv=r.info.pv.slice(0,1);traces.push({fen:args[1],budget:args[4],result:r});report.dataset.trace=JSON.stringify(traces);return r;};
  const original=boardKey(board), root=buildCurrentEnginePositionState(guideCurrentCacheBudgets());
  if(new URLSearchParams(location.search).has('early-preview')) {
   gameMode=null;
   buildLineView(board,currentPlayer,[generateLegalMoves(board,currentPlayer)[0]],[]);
   stepLineView(1);
   if(!linePreviewGameSnapshot || !linePreviewGameSnapshot.guideLinePositionState)throw Error('Guide preview lost real root');
  }
  const job={state:root,budgets:root.budgets,move:generateLegalMoves(root.board,root.side)[0],reportIndex:1};
  const cacheReport={brain:mode,totalJobs:1,jobs:[job],open:true};
  guidePrefetchBranchReport=cacheReport;renderGuidePrefetchDetails();
  setGuidePrefetchStatus('Cache display preservation test',true);
  const cache=prefetchBranchPikafish(job,engine==='pikafishweb',guidePrefetchToken);
  guideLineEngine=engine;
  await new Promise((resolve,reject)=>{
   const build=buildCurrentGuideLine;
   const timeout=setTimeout(()=>reject(Error('Timed out scheduling line')),45000);
   buildCurrentGuideLine=async function(...args){
    try {
     if(guidePikaCacheActive)throw Error('Preview overlaps cache search');
     const before=['guidePrefetchStatus','guidePrefetchDetails'].map(id=>document.getElementById(id).innerHTML);
     await build(...args);
     if(guidePrefetchBranchReport!==cacheReport)throw Error('Cache report replaced');
     if(before.some((html,i)=>html!==document.getElementById(['guidePrefetchStatus','guidePrefetchDetails'][i]).innerHTML))throw Error('Cache display changed by preview');
     clearTimeout(timeout);resolve();
    }catch(e){clearTimeout(timeout);reject(e);}
   };
   scheduleCurrentGuideLine();
  });
  await cache;
  if(linePreviewGameSnapshot)restoreLinePreview(true);
  if(boardKey(board)!==original)throw Error('Changed real board');
  const final=lineViewSteps.at(-1).board;
  const ended=generateLegalMoves(final,'black').length===0;
  if(!defense && (!ended || !lineViewBuildStatus.includes('kết thúc thắng')))throw Error('Incomplete: '+lineViewBuildStatus);
  if(defense && lineViewSteps.length<=2)throw Error('Defense line stuck at one move: '+lineViewBuildStatus);
  if(lineViewSteps.length>9)throw Error('Exceeded remaining moves');
  report.textContent='PASS '+mode+' via '+engine+' '+(lineViewSteps.length-1)+' plies; cache display preserved; real board unchanged; '+(defense?'remaining horizon checked':'terminal verified');
  cancelCurrentGuideLine();cancelGuidePrefetch();
 } catch(e) {report.textContent='FAIL '+engine+' '+e.stack+'\n'+report.dataset.trace;}
});
