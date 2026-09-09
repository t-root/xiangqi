window.addEventListener('DOMContentLoaded', async () => {
 const report=document.createElement('pre');report.id='history-test-result';
 report.style='position:fixed;inset:0 0 auto 0;z-index:999999;background:white;color:black;padding:12px;white-space:pre-wrap;max-height:50vh;overflow:auto';
 document.body.append(report);
 const log=[],commands=[];const check=(ok,message)=>{if(!ok)throw Error(message);log.push(message);report.textContent='RUNNING\n'+log.join('\n');};
 const mode=new URLSearchParams(location.search).get('mode')||'nativecombo';
 const web=mode==='webcombo',parts=compositeBrains(mode);
 const wrapped=new WeakSet();
 const wrap=ws=>{if(!wrapped.has(ws)){wrapped.add(ws);const send=ws.send.bind(ws);ws.send=cmd=>{if(cmd.startsWith('position '))commands.push(cmd);return send(cmd);};}return ws;};
 try {
  report.textContent='RUNNING '+mode;
  getAnalysisTimeLimitMs=()=>500;
  if(web) {
   await pikafishWebLoad();await loadBruteForceWeb();
   const send=pikafishWebSend;pikafishWebSend=cmd=>{if(cmd.startsWith('position '))commands.push(cmd);return send(cmd);};
   const prep=prepareBruteForceWebQuery;prepareBruteForceWebQuery=async(...args)=>wrap(await prep(...args));
  } else {
   const pika=preparePikafishQuery,bf=prepareBruteForceQuery;
   preparePikafishQuery=async(...args)=>wrap(await pika(...args));
   prepareBruteForceQuery=async(...args)=>wrap(await bf(...args));
  }
  board=parseXiangqiFen('3k4r/9/9/9/9/9/9/p8/9/R3K4 w - - 0 1').board;
  currentPlayer='red';gameMode=true;gameFirstPlayer='red';gameUsesAnalysisRule=false;applyGameCheckStreakRule();
  gameOver=false;guideActive=false;gameUndoStack=[];gameRedoStack=[];gameHistory=[];
  sideControl.red='human';sideControl.black='human';liveCheckStreak={red:0,black:0};resetRepetitionWindow();
  positionHistory=[repetitionEntry(board,currentPlayer,null)];
  const rootFen=boardToXiangqiFen(board,currentPlayer);
  for(const uci of ['a0a1','i9i8','a1a2'])executeMove(parseUciMove(uci,board));
  const expected='position fen '+rootFen+' moves a0a1 i9i8 a1a2';
  check(buildEnginePositionState(buildCurrentEnginePositionState()).cmd===expected,'actual executeMove retains history across capture');
  const captured=snapshotGameState();restoreGameState(gameUndoStack.at(-1));
  check(movesSinceCapture.length===2,'undo restores prefix');restoreGameState(captured);
  for(const brain of parts){
   commands.length=0;
   const res=await querySingleEngineMove(brain,boardToXiangqiFen(board,currentPlayer),currentPlayer,500,1);
   check(commands.length>0&&commands.every(cmd=>cmd===expected),brain+' receives complete position command');
   check(!!res.moveStr,brain+' returns a move with full history');
  }
  commands.length=0;
  const res=await queryCompositeMove(mode,boardToXiangqiFen(board,currentPlayer),currentPlayer,1);
  check(commands.length>=2&&commands.every(cmd=>cmd===expected),mode+' sends history to both engines');
  check(!!res.moveStr,mode+' returns a move');
  lastAnalysisPositionState=buildCurrentEnginePositionState();
  const root=cloneBoard(board),side=currentPlayer;
  const next=buildHypotheticalStateAfterMove(lastAnalysisPositionState,parseUciMove('i8i7',board));
  playbackLineMoves=[{boardState:root,activePlayer:side,moveDesc:'Thế gốc'},
   {boardState:next.board,activePlayer:next.side,moveDesc:'Xe Đen: i8i7'}];playbackIndex=1;
  check(buildPlaybackEnginePositionState(1).repetitionMoves.length===4,'playback extends pre-analysis history');
  board=cloneBoard(next.board);currentPlayer=next.side;isPlaybackActive=true;
  executeInterventionMove(parseUciMove('a2b2',board));
  check(movesSinceCapture.length===5,'actual intervention preserves complete history and adds new move');
  lastAnalysisSnapshot=cloneBoard(root);lastAnalysisFirstPlayer=side;guideAttacker=null;
  const refresh=refreshGuide;refreshGuide=()=>{};
  try{startGuideSession('play',side);}finally{refreshGuide=refresh;}
  check(movesSinceCapture.length===3,'guide restart restores analysis history instead of stale live branch');
  report.textContent='PASS '+mode+'\n'+log.join('\n');
 } catch(e) {report.textContent='FAIL '+mode+'\n'+log.join('\n')+'\n'+e.stack;}
 finally {stopActiveEngineRuntimes('Kết thúc kiểm thử lịch sử.');}
});
