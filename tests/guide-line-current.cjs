const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const parser=require('../engine/node_modules/@babel/parser');
const html=fs.readFileSync(require('node:path').join(__dirname,'../xiangqi-analyzer.html'),'utf8');
const c=vm.createContext({guideLineKey:'',guideActive:true,linePreviewGameSnapshot:null,board:'B',boardKey:b=>b,
 currentPlayer:'black',guideSide:'red',guideBestMove:null,lineViewIndex:2,lineViewBuildStatus:'old',
 lineViewSteps:[{board:'A'},{board:'B'},{board:'C'}],refreshLineViewRow(){}});
c.buildLineView=(board)=>{c.lineViewSteps=[{board}];c.lineViewIndex=0;};
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))for(const n of parser.parse(m[1]).program.body)
 if(n.type==='FunctionDeclaration'&&n.id.name==='syncGuideLineToCurrentPosition')vm.runInContext(m[1].slice(n.start,n.end),c);
c.syncGuideLineToCurrentPosition();
assert.equal(c.lineViewSteps[0].board,'B');assert.equal(c.lineViewSteps[1].board,'C');assert.equal(c.lineViewIndex,0);
c.board='off-line';c.syncGuideLineToCurrentPosition();
assert.equal(c.lineViewSteps.length,1);assert.equal(c.lineViewSteps[0].board,'off-line');
c.linePreviewGameSnapshot={};c.board='preview';c.syncGuideLineToCurrentPosition();
assert.equal(c.lineViewSteps[0].board,'off-line');
console.log('PASS guide line follows actual moves, clears stale branch, preserves active preview');
