window.addEventListener('DOMContentLoaded',async()=>{
 const report=document.createElement('pre');report.id='composite-test-result';
 report.style='position:fixed;inset:0 0 auto 0;z-index:999999;background:white;color:black;padding:12px;white-space:pre-wrap;font-size:16px;max-height:45vh;overflow:auto';
 document.body.append(report);
 const mode=new URLSearchParams(location.search).get('mode')==='webcombo'?'webcombo':'nativecombo';
 const states={};let completed=false;
 const render=()=>report.textContent=(completed?'PASS ':'RUNNING ')+mode+' — actual live guide route\n'+Object.entries(states).map(([b,i])=>`${b}: depth ${i.depth||0}, ${i.engineStatus}`).join('\n');
 render();
 try{
  if(mode==='webcombo')await Promise.all([pikafishWebLoad(),loadBruteForceWeb()]);
  const parsed=parseXiangqiFen('9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1');
  board=parsed.board;currentPlayer='red';guideSide='red';guideAttacker='red';guideEngine=mode;
  guideActive=true;guideMode='win';guideMovesTarget=4;guideMaxMoves=4;guideMovesUsed=0;guideOfferLocked=false;gameOver=false;
  resetGuidePlanCaches();pendingCompositeGuideChoice=null;
  getAnalysisTimeLimitMs=()=>1500;
  const original=queryCompositeGuideCandidates;
  queryCompositeGuideCandidates=async function(...args){
   const callback=args[5];args[5]=(brain,info)=>{states[brain]={...info};render();if(callback)callback(brain,info);};
   const result=await original(...args);
   if(compositeBrains(mode).every(b=>states[b]&&states[b].depth>0&&states[b].engineStatus==='ready')){
    completed=true;render();
   }else{report.textContent='FAIL '+mode+'\n'+JSON.stringify(states,null,2);}
   return result;
  };
  refreshGuide();
  setTimeout(()=>{if(!completed)report.textContent='FAIL timeout '+mode+'\n'+JSON.stringify(states,null,2);},45000);
 }catch(e){report.textContent='FAIL '+mode+' '+e.stack;}
});
