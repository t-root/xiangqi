const path=require('node:path');
const {spawnSync}=require('node:child_process');
const onlyLogic=process.argv.includes('--logic');
const suite=onlyLogic?['composite-regression.cjs','cache-logic-smoke-test.js']
    :['crash-regression.cjs','composite-regression.cjs','cache-logic-smoke-test.js'];
suite.push('pikafish-resources.cjs');
suite.push('pikafish-cache-order.cjs');
suite.push('pikafish-cache-adapter.cjs');
suite.push('guide-line-current.cjs');
suite.push('guide-line-build.cjs');
suite.push('bruteforce-proof-line.cjs');
suite.push('history-regression.cjs');
suite.push('analysis-engine-lines.cjs');
suite.push('web-native-display-parity.cjs');
for(const file of suite){
    console.log('\n>>> '+file);
    const result=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true});
    if(result.error){console.error(result.error.message);process.exit(1);}
    if(result.status!==0)process.exit(result.status||1);
}
console.log('\nAll requested tests passed.');
