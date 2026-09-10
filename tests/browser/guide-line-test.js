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
   if(new URLSearchParams(location.search).has('initial')) {
    const draw=new URLSearchParams(location.search).has('draw');
    if(draw)board=parseXiangqiFen('3k5/9/9/9/9/9/9/9/9/5K3 w - - 0 1').board;
    guideActive=false;gameMode=false;gameUsesAnalysisRule=false;
    document.getElementById('modeMoves').checked=true;document.getElementById('modeTime').checked=false;
    document.getElementById('movesLimit').value=draw?'2':'4';
    document.getElementById('firstPlayer').value='red';document.getElementById('engineBrainSelect').value=mode;
    let initialBuilds=0;
    const proof=refineWorstCaseLine,drawLine=buildDrawPreviewLineBruteForce;
    refineWorstCaseLine=function(...args){initialBuilds++;return proof(...args);};
    buildDrawPreviewLineBruteForce=function(...args){initialBuilds++;return drawLine(...args);};
    await startAnalysisBruteForce(engine==='bruteforceweb');
    const deadline=Date.now()+45000;
    while(analysisRunning || lineViewProofState==='pending') {
     if(Date.now()>deadline)throw Error('Initial line timed out');
     await new Promise(r=>setTimeout(r,50));
    }
    if(initialBuilds!==1 || lineViewProofState==='unavailable' || lineViewSteps.length<3)throw Error('Initial BF line missing');
    const initialLine=lineViewSteps,plies=initialLine.length-1;
    if(draw && plies!==4)throw Error('Initial draw line must cover both budgets');
    if(!draw && generateLegalMoves(initialLine.at(-1).board,'black').length)throw Error('Initial mate line must finish at mate');
    startGuideSession(draw?'drawproof':'win','red');
    cancelGuidePrefetch();
    for(const step of initialLine.slice(1,3)) {
     const move=generateLegalMoves(board,currentPlayer).find(m=>moveToUci(m)===moveToUci(step.lastMove));
     if(!move)throw Error('Initial line cannot be followed');
     executeMove(move);cancelGuidePrefetch();
     if(lineViewSteps!==initialLine || initialBuilds!==1 || guideLineRunning)throw Error('BF rebuilt line after a move');
    }
    report.textContent='PASS '+mode+': initial '+(draw?'draw':'mate')+' line '+plies+' plies; two played moves preserve line; no rebuild';
    hideGuide();return;
   }
   const savedLine=[{board:cloneBoard(board),desc:'saved root'},{board:cloneBoard(board),desc:'saved continuation'}];
   lineViewSteps=savedLine;lineViewIndex=1;lineViewBuildStatus='saved';lineViewProofState='';
   const screenshotCase=new URLSearchParams(location.search).has('screenshot');
   board=parseXiangqiFen(screenshotCase
    ? '3k5/7N1/3c5/4R4/8R/1N7/9/5K3/1C7/9 b - - 0 1'
    : '3k5/9/9/9/9/9/9/9/9/5K3 b - - 0 1').board;
   currentPlayer='black';guideSide='black';guideMode='defense';guideMovesTarget=2;guideMaxMoves=2;
   gameMode=true;gameUsesAnalysisRule=true;guideOfferLocked=false;ktcBudgetOn=false;
   applyAnalysisCheckStreakRule('red');
   installEngineHistory(buildStandaloneEnginePositionState(board,currentPlayer));
   const root=buildCurrentEnginePositionState(guideCurrentCacheBudgets());
   const job={state:root,budgets:root.budgets,move:generateLegalMoves(board,currentPlayer)[0]};
   const calls=[],go=runBruteForceGo;
   runBruteForceGo=async function(ws,cmd,...args){calls.push(cmd);const result=await go(ws,cmd,...args);
    report.dataset.trace=JSON.stringify({calls,result});return result;};
   const done=await prefetchBranchBruteForce(job,engine==='bruteforceweb',guidePrefetchToken);
   if(!done || job.engineJobs[engine].status!=='PROVEN_HOLD')throw Error('Missing cached hold proof');
   calls.length=0;
   await refreshDefenseGuideMoveBruteForce(0,engine==='bruteforceweb');
   if(!guideBestMove)throw Error('Completed proof did not produce a guide move');
   if(calls.some(cmd=>cmd==='go budget 2'))throw Error('Repeated already-cached root proof');
   if(calls.some(cmd=>cmd!=='go budgets red 2 black 1'))throw Error('Child proof must consume the defender move');
   if(lineViewSteps!==savedLine || lineViewIndex!==1 || lineViewBuildStatus!=='saved')throw Error('BF guide changed saved line');
   const move=moveToUci(guideBestMove);
   guidePlan={};guideProofPlan={};guideBestMove=null;calls.length=0;
   await refreshDefenseGuideMoveBruteForce(0,engine==='bruteforceweb');
   if(!guideBestMove || moveToUci(guideBestMove)!==move || calls.length)throw Error('Missed engine-local cached move');
   if(lineViewSteps!==savedLine || lineViewIndex!==1)throw Error('Cache hit changed saved line');
   report.textContent='PASS '+mode+': cached proof produces '+move+'; engine-local cache reused without search; guide preserves line';
   cancelCurrentGuideLine();cancelGuidePrefetch();return;
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
