// Recovery only: read historical patches as data, never execute recorded commands.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const parser=require('../../engine/node_modules/@babel/parser');
const root=path.resolve(__dirname,'../..');
const targets={
 'cache-logic-smoke-test.js':'tests/cache-logic-smoke-test.js',
 'CRASH-AUDIT-2026-09-05.md':'tests/reports/CRASH-AUDIT-2026-09-05.md',
 'COMPOSITE-FIX-2026-09-05.md':'tests/reports/COMPOSITE-FIX-2026-09-05.md',
 'engine/composite-regression.cjs':'tests/composite-regression.cjs',
 'engine/composite-browser-test.js':'tests/browser/composite-browser-test.js',
 'engine/wasm-crash-test.html':'tests/browser/wasm-crash-test.html',
 'engine/serve-crash-test.cjs':'tests/serve-crash-test.cjs',
 'engine/serve-composite-test.cjs':'tests/serve-composite-test.cjs',
 'engine/crash-regression.cjs':'tests/crash-regression.cjs',
 'engine/crash-baseline.cjs':'tests/crash-baseline.cjs',
 'engine/bruteforce-src/src/debug_root_streak.cpp':'tests/native/debug_root_streak.cpp'
};
const patches=[];
const logs=JSON.parse(fs.readFileSync(path.join(__dirname,'recovery-log-paths.json'),'utf8').replace(/^\uFEFF/,''));
function strings(node,out=[]){if(!node||typeof node!=='object')return out;if(node.type==='StringLiteral')out.push(node.value);
 for(const [k,v]of Object.entries(node)){if(k==='loc'||k==='extra')continue;if(Array.isArray(v))for(const x of v)strings(x,out);else if(v&&typeof v==='object')strings(v,out);}return out;}
for(const log of logs){for(const line of fs.readFileSync(log,'utf8').split('\n')){if(!line.trim())continue;let entry;try{entry=JSON.parse(line);}catch{continue;}
 const p=entry.payload;if(!p||!['custom_tool_call','function_call'].includes(p.type))continue;
 const input=p.input||p.arguments||'';if(typeof input!=='string'||!input.includes('*** Begin Patch'))continue;
 let values=[];if(input.startsWith('*** Begin Patch'))values=[input];else{try{values=strings(parser.parse(input,{sourceType:'module',allowAwaitOutsideFunction:true}));}catch{try{values=strings({type:'StringLiteral',value:JSON.parse(input).patch});}catch{}}}
 for(const value of values)if(typeof value==='string'&&value.startsWith('*** Begin Patch')&&Object.keys(targets).some(t=>value.includes(t)))patches.push({patch:value,time:entry.timestamp||'',call:p.call_id||p.id,log:path.basename(log)});
}}
patches.sort((a,b)=>a.time.localeCompare(b.time));
const files=new Map(),seen=new Set(),provenance={};
for(const record of patches){const key=record.call+'|'+record.patch;if(seen.has(key))continue;seen.add(key);
 const lines=record.patch.replace(/\r\n/g,'\n').split('\n');
 for(let i=0;i<lines.length;i++){
  const header=/^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines[i]);if(!header)continue;
  const name=header[2].replaceAll('\\','/').replace(/^.*?\/xiangqi\//,'');let end=i+1;while(end<lines.length&&!/^\*\*\* (?:Add|Update|Delete) File:|^\*\*\* End Patch/.test(lines[end]))end++;
  if(!targets[name]){i=end-1;continue;}const chunk=lines.slice(i+1,end);
  if(header[1]==='Add'){files.set(name,chunk.filter(l=>l.startsWith('+')).map(l=>l.slice(1)).join('\n')+'\n');}
  else if(header[1]==='Update'&&files.has(name)){
   let text=files.get(name);const hunks=[];let h=[];
   for(const l of chunk){if(l.startsWith('@@')){if(h.length)hunks.push(h);h=[];}else if(!l.startsWith('***'))h.push(l);}if(h.length)hunks.push(h);
   for(const lines of hunks){const before=lines.filter(l=>l.startsWith(' ')||l.startsWith('-')).map(l=>l.slice(1)).join('\n');const after=lines.filter(l=>l.startsWith(' ')||l.startsWith('+')).map(l=>l.slice(1)).join('\n');
    if(!before)continue;if(text.includes(before))text=text.replace(before,after);else console.warn('Unmatched patch hunk:',name,record.time);
   }files.set(name,text);
  }
  // Deletions are deliberately ignored: recover the last contents before cleanup.
  provenance[name]={destination:targets[name],log:record.log,time:record.time};i=end-1;
 }
}
for(const [name,dest]of Object.entries(targets)){const text=files.get(name);if(!text){console.log('MISSING '+name);continue;}const output=path.join(root,dest);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,text);provenance[name].sha256=crypto.createHash('sha256').update(text).digest('hex');console.log('RECOVERED '+dest);}
fs.writeFileSync(path.join(root,'tests/reports/recovered-sources.json'),JSON.stringify(provenance,null,2)+'\n');
