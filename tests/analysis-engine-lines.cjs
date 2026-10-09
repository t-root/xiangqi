const assert = require('node:assert/strict');
const {context, fixture, move} = require('./history-regression.cjs');
for (const combo of ['nativecombo', 'webcombo']) {
  const c = context();
  fixture(c);
  for (const row of c.board) for (const piece of row) if(piece) piece.type=piece.color+piece.type[0].toUpperCase()+piece.type.slice(1);
  c.resetRepetitionWindow();
  const root = c.buildCurrentEnginePositionState();
  const brains = combo === 'nativecombo' ? ['pikafish','bruteforce'] : ['pikafishweb','bruteforceweb'];
  Object.assign(c, {lastAnalysisPositionState:root,lastAnalysisSnapshot:root.board,lastAnalysisFirstPlayer:'red',
    lastAnalysisEngineLines:{},lastAnalysisGuideSeed:null,guideActive:true,guideMode:'win',guideSide:'red',
    guideAttacker:'red',guideEngine:combo,guideMovesTarget:4,guideMaxMoves:4,guideMovesUsed:0,
    guideCompositeLineChosen:true,
    guideToken:0,guideOfferLocked:false,BRAIN_IDS:[combo,...brains],
    document:{getElementById:()=>({})},renderAnalysisEngineLines(){},houseRuleLossReason:()=>null,
    syncCheckStreakRestrictedForGame(){},prioritizeFullCacheCurrentBranch(){},fullCacheConstrained:()=>false,
    showWinGuideMove(m){c.answer=m;},showDefenseGuideMove(m){c.answer=m;},
    refreshPlayGuideMoveComposite(){c.queries=(c.queries||0)+1;}});
  c.rememberCompositeAnalysisLines({engineReports:brains.map((engine,i)=>({engine,
    info:{scoreType:'mate',scoreVal:4,pv:[i?'a0a2':'a0a1','i9i8','a'+(i?'2':'1')+'b'+(i?'2':'1')]},
    moveStr:i?'a0a2':'a0a1'}))},{board:root.board,firstPlayer:'red'});
  for (const engine of brains) {
    const seed=c.lastAnalysisEngineLines[engine];
    assert.equal(seed.moves.length,3);
    assert.equal(seed.sourceBrain,engine);
    c.lastAnalysisGuideSeed=seed;c.guideSide='red';c.guideMode='win';
    c.board=c.cloneBoard(root.board);c.currentPlayer='red';c.installEngineHistory(root);
    c.refreshGuide();assert.equal(c.moveToUci(c.answer),c.moveToUci(seed.moves[0]));
    let state=c.buildHypotheticalStateAfterMove(root,seed.moves[0]);
    c.board=state.board;c.currentPlayer=state.side;c.installEngineHistory(state);
    c.guideSide='black';c.guideMode='defense';c.guideMovesUsed=1;
    const hit=c.recallAnalysisSeedMove(c.board,'black');
    assert.equal(hit.sourceBrain,engine);assert.equal(hit.movesLeft,3);
    c.refreshGuide();assert.equal(c.moveToUci(c.answer),'i9i8');assert.equal(c.queries,undefined);
    // Identical board reached without the recorded prefix must not reuse this line.
    c.installEngineHistory(c.buildStandaloneEnginePositionState(c.board,'black'));
    assert.equal(c.recallAnalysisSeedMove(c.board,'black'),null);
    c.refreshGuide();assert.equal(c.queries,1);c.queries=undefined;
    // The same side takes a different legal move: return to the existing live route.
    state=c.buildHypotheticalStateAfterMove(root,move(9,0,9,1));
    c.board=state.board;c.currentPlayer=state.side;c.installEngineHistory(state);
    c.refreshGuide();assert.equal(c.queries,1);c.queries=undefined;
  }
  assert.notEqual(c.moveToUci(c.lastAnalysisEngineLines[brains[0]].moves[0]),
    c.moveToUci(c.lastAnalysisEngineLines[brains[1]].moves[0]));
  c.board=c.cloneBoard(root.board);c.currentPlayer='red';c.installEngineHistory(root);
  c.guideSide='red';c.guideMode='win';c.guideCompositeLineChosen=false;
  c.refreshGuide();assert.equal(c.queries,1,'The root of a composite guide must ask the user to choose an engine move');
  // Selecting Red starts directly on the completed BF PV, with no new composite query.
  c.queries=undefined;c.guideAttacker=null;c.guideMode='play';c.guideCompositeLineChosen=true;
  c.compositeRedGuideSeed=c.lastAnalysisEngineLines[brains[1]];
  c.BRAIN_LABELS={ [brains[1]]: 'Brute-force' };
  c.setGuideUI=()=>{};c.describeGuideMove=()=>'';c.guideMoveNumberText=()=>'';c.guideSwitchBtn=()=>'';
  c.refreshGuide();assert.equal(c.moveToUci(c.guideBestMove),c.moveToUci(c.compositeRedGuideSeed.moves[0]));
  assert.equal(c.queries,undefined,'Red must reuse BF PV before analysis');
  // After Black chooses a different reply, the saved BF PV no longer matches and analysis resumes.
  let redState=c.buildHypotheticalStateAfterMove(root,c.compositeRedGuideSeed.moves[0]);
  redState=c.buildHypotheticalStateAfterMove(redState,move(0,8,0,7));
  c.board=redState.board;c.currentPlayer=redState.side;c.installEngineHistory(redState);
  c.refreshGuide();assert.equal(c.queries,1,'A deviation from BF PV must return to analysis');
  console.log('PASS '+combo+': distinct original lines; root asks for an engine move; attack/defense reuse without queries; history and deviation fallback');
}
