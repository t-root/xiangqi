window.addEventListener('DOMContentLoaded', async () => {
 const report=document.createElement('pre');report.id='initial-lines-test-result';
 report.style='position:fixed;bottom:0;left:0;right:0;z-index:999999;background:white;color:black;padding:6px;white-space:pre-wrap;font-size:12px;max-height:45px;overflow:auto';document.body.prepend(report);
 const mode=new URLSearchParams(location.search).get('mode')==='webcombo'?'webcombo':'nativecombo';
 report.textContent='RUNNING '+mode+' original lines';
 try {
  if(mode==='webcombo') await Promise.all([pikafishWebLoad(),loadBruteForceWeb()]);
  board=parseXiangqiFen('9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1').board;
  currentPlayer='red';gameMode=false;guideActive=false;
  document.getElementById('engineBrainSelect').value=mode;
  document.getElementById('firstPlayer').value='red';
  document.getElementById('modeMoves').checked=false;document.getElementById('modeTime').checked=true;
  document.getElementById('movesLimit').value=4;getAnalysisTimeLimitMs=()=>mode==='webcombo'?10000:1500;
  // Isolate foreground guidance from intentionally unrelated background branch work.
  scheduleGuideNextPlyPrefetch=()=>{};
  await startAnalysisComposite(mode);
  const engines=compositeBrains(mode);
  if(engines.some(e=>!lastAnalysisEngineLines[e]?.moves.length))throw Error('Missing engine line');
  if(document.querySelectorAll('#analysisEngineLines > div').length!==2)throw Error('Missing separate line cards');
  let liveCalls=0;const live=querySingleEngineGuideMove;
  querySingleEngineGuideMove=(...args)=>{liveCalls++;return live(...args);};
  for(const engine of engines) {
   followAnalysisEngineLine(engine);
   if(!guideActive || lastAnalysisGuideSeed.sourceBrain!==engine)throw Error('Source selection failed');
   const seed=lastAnalysisGuideSeed;
   const original=JSON.stringify(seed.moves);
   for(let i=0;i<Math.min(3,seed.moves.length);i++) {
    guideSide=currentPlayer;guideMode=currentPlayer===guideAttacker?'win':'defense';
    refreshGuide();
    if(!guideBestMove || moveToUci(guideBestMove)!==moveToUci(seed.moves[i]))throw Error('Wrong guide move '+engine+' step '+i);
    executeMove(generateLegalMoves(board,currentPlayer).find(m=>moveToUci(m)===moveToUci(seed.moves[i])));
   }
   const before=JSON.stringify(snapshotGameState());
   const beforeView=JSON.stringify(lineViewSteps),beforeSource=guideLineEngine;
   previewAnalysisEngineLine(engines.find(e=>e!==engine));stepLineView(1);restoreLinePreview(true);
   if(JSON.stringify(snapshotGameState())!==before)throw Error('Preview changed game');
   if(JSON.stringify(lineViewSteps)!==beforeView || guideLineEngine!==beforeSource)throw Error('Preview did not restore selected line');
   if(JSON.stringify(seed.moves)!==original)throw Error('Original line mutated');
   guideSide=currentPlayer;guideMode=currentPlayer===guideAttacker?'win':'defense';refreshGuide();
   await new Promise(r=>setTimeout(r,500));
   cancelCurrentGuideLine();
  }
  await new Promise(r=>setTimeout(r,500));
  if(liveCalls)throw Error('Repeated engine queries on original line: '+liveCalls);
  restoreAnalysisCheckpoint();
  report.textContent='PASS '+mode+': both original lines shown; selected source, 3 played plies, defense, preview/restore; 0 repeated engine queries';
 } catch(e) { report.textContent='FAIL '+mode+' '+e.stack; }
});
