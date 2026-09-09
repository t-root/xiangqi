const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const logs=JSON.parse(fs.readFileSync(path.join(__dirname,'recovery-log-paths.json'),'utf8').replace(/^\uFEFF/,''));
const found=[];
for(const log of logs)for(const line of fs.readFileSync(log,'utf8').split('\n')){
 if(!line.includes('debug_root_streak.cpp')&&!line.includes('bruteforce.paralleltest.exe'))continue;
 let e;try{e=JSON.parse(line);}catch{continue;}const p=e.payload||{};
 if(!['custom_tool_call','function_call'].includes(p.type))continue;
 const input=p.input||p.arguments||'';
 if(input.length<20000&&input.includes('debug_root_streak.cpp')&&/Set-Content|WriteAllText|cat |write_text|writeFile|Add File|Get-Content.*debug_root_streak|read_text/.test(input))found.push({log:path.basename(log),time:e.timestamp,input});
 if(input.length<8000&&input.includes('paralleltest.exe')&&/g\+\+|Copy-Item|cp |rename|move/i.test(input))found.push({log:path.basename(log),time:e.timestamp,input});
}
fs.writeFileSync(path.join(root,'tests/tools/recovery-candidates.json'),JSON.stringify(found,null,2));
for(const x of found)console.log(x.log,x.time,x.input.slice(0,500));
const exe=fs.readFileSync(path.join(root,'dist/XiangqiAnalyzer.exe'));
console.log('PACKAGED TAIL',exe.subarray(-2600).toString('utf8'));
