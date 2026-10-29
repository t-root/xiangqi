window.addEventListener('DOMContentLoaded', async () => {
 const report = document.createElement('pre'); report.id='cache-repro';
 report.style='position:fixed;inset:0;z-index:999999;background:white;color:black;overflow:auto';document.body.append(report);
 const events=[]; let failure=null, dispatches=0, deepest=0; const original=console.debug;
 console.debug=(...args)=>{original(...args);if(args[0]==='[CACHE]'){events.push(args[1]);if(events.length>6)events.shift();}};
 try {
  board=parseXiangqiFen('3a3P1/4nk3/4Pa3/9/7r1/9/9/4K4/4A4/8C w - - 0 1').board;
  currentPlayer='red';gameFirstPlayer='red';gameMode=true;gameOver=false;
  setSideControl('red','human');setSideControl('black','human');
  gameUsesAnalysisRule=true;applyAnalysisCheckStreakRule('red');
  positionHistory=[repetitionEntry(board,currentPlayer,null)];liveCheckStreak={red:0,black:0};
  resetRepetitionWindow();
  guideSide='red';guideAttacker='red';guideEngine=new URLSearchParams(location.search).get('engine')||'pikafish';guideActive=true;guideMode='win';
  guideMovesTarget=4;guideMaxMoves=4;guideMovesUsed=0;guideOfferLocked=false;guideThinking=false;
  getAnalysisTimeLimitMs=()=>600;resetGuidePlanCaches();
  const originalDispatch=markCacheAttemptDispatched;
  markCacheAttemptDispatched=function(job,run){
   const pending=(guidePrefetchBranchReport?.jobs||[]).map(j=>j.engineJobs?.[guideEngine]).filter(Boolean);
   if(pending.filter(j=>j.attemptInFlight).length>1) failure='overlapping searches';
   if(pending.some(j=>!cacheAttemptFinished(j)&&!cacheAttemptTerminalFailure(j)&&j.attempt<job.attempt)) failure='higher round overtook lower round';
   dispatches++; return originalDispatch(job,run);
  };
  const started=Date.now();
  report.textContent='RUNNING';renderBoard();executeMove({from:{row:9,col:8},to:{row:9,col:2}});
  const ticker=setInterval(()=>{
   const jobs=(guidePrefetchBranchReport?.jobs||[]).map(j=>({index:j.index,...Object.fromEntries(['attempt','status','lastDepth','activeRunId'].map(k=>[k,j.engineJobs?.[guideEngine]?.[k]]))}));
   deepest=Math.max(deepest,...jobs.map(j=>j.lastDepth||0));
   const passed=jobs.length===20&&jobs.every(j=>j.status?.startsWith('READY')||j.status==='HORIZON_MISS'||j.attempt>=3);
   const done=!!failure||passed||Date.now()-started>90000;
   const result=failure?'FAIL '+failure:passed?'PASS':done?'FAIL timeout':'RUNNING';
   report.textContent=JSON.stringify({result,engine:guideEngine,dispatches,deepest,jobs,events},null,2);
   if(done){clearInterval(ticker);stopBackgroundCacheForLive(guideEngine);}
  },500);
 } catch(e){report.textContent=e.stack;}
});
