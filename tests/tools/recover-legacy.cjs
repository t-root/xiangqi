const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const exe=fs.readFileSync(path.join(root,'dist/XiangqiAnalyzer.exe'));
const marker=Buffer.from('(function(process, require, console, EXECPATH_FD, PAYLOAD_POSITION, PAYLOAD_SIZE) {');
const start=exe.lastIndexOf(marker);if(start<0)throw Error('Package prelude not found');
const tail=exe.subarray(start).toString('utf8');
const jsonStart=tail.lastIndexOf('\n{"C:');const jsonEnd=tail.indexOf('\n,',jsonStart);
const vfs=JSON.parse(tail.slice(jsonStart+1,jsonEnd));
const payloadSize=Math.max(...Object.values(vfs).flatMap(v=>Object.values(v).map(([off,len])=>off+len)));
const payloadStart=start-payloadSize;
const name=Object.keys(vfs).find(p=>p.endsWith('bruteforce-src\\src\\bruteforce.exe'));
const [offset,size]=vfs[name]['1'];const bf=exe.subarray(payloadStart+offset,payloadStart+offset+size);
if(bf.toString('ascii',0,2)!=='MZ')throw Error('Recovered file is not PE');
fs.writeFileSync(path.join(root,'tests/binaries/bruteforce.before.exe'),bf);
console.log('Recovered BF from original packaged application:',size,crypto.createHash('sha256').update(bf).digest('hex'));
const log='C:/Users/T-Root/.codex/sessions/2026/08/27/rollout-2026-08-27T04-05-12-01a03fe4-2ae2-78c0-90fc-40a91bd3e108.jsonl';
const entries=fs.readFileSync(log,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const call=entries.find(e=>e.payload?.input?.includes('Get-Content engine\\\\bruteforce-src\\\\src\\\\debug_root_streak.cpp -Raw'));
if(!call)throw Error('Historical debug read not found');
const reply=entries.find(e=>e.payload?.call_id===call.payload.call_id&&e.payload.type.endsWith('output'));
let output=reply?.payload.output;
if(Array.isArray(output))output=output.map(x=>x.text||'').join('\n');
if(typeof output!=='string'){console.log('Response structure',JSON.stringify(reply).slice(0,1000));process.exit(1);}
fs.writeFileSync(path.join(root,'tests/tools/debug-recovery-output.txt'),output);
const begin=output.indexOf('\n// ')+1;
if(begin<0){console.log(output.slice(0,700));throw Error('Debug source not found in output');}
const source=output.slice(begin);const boundary=source.search(/\r?\nengine[\\/]/);
if(boundary<0)throw Error('Cannot delimit historical source from search output');
let debug=source.slice(0,boundary).trimEnd()+'\n';
// PowerShell's old console read UTF-8 as Windows-1252; reverse that encoding.
const cp=new TextDecoder('windows-1252');const inverse=new Map();
for(let i=0;i<256;i++)inverse.set(cp.decode(Uint8Array.of(i)),i);
const cp1252='€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
[...cp1252].forEach((c,i)=>inverse.set(c,0x80+i));
if(debug.includes('Ã')||debug.includes('á»'))debug=Buffer.from([...debug].map(c=>inverse.get(c)??c.charCodeAt(0))).toString('utf8');
fs.mkdirSync(path.join(root,'tests/native'),{recursive:true});fs.writeFileSync(path.join(root,'tests/native/debug_root_streak.cpp'),debug);
console.log('Recovered debug source:',Buffer.byteLength(debug));
