const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const {WebSocketServer}=require('../engine/node_modules/ws');
const root=path.resolve(__dirname,'..'),children=[],sockets=[],timers=new Set();let closed=false;
const source=fs.readFileSync(path.join(root,'engine/server.js'),'utf8');
const context={console,spawn:(...args)=>{const c=spawn(...args);children.push(c);return c;},
 WebSocketServer:class extends WebSocketServer{constructor({port}){super({port,host:'127.0.0.1'});sockets.push(this);}},
 killPortIfBusy(){},getLocalIP:()=> '127.0.0.1',clearTimeout,
 setTimeout:(fn,ms)=>{if(closed)return 0;const t=setTimeout(fn,ms);timers.add(t);return t;}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function startBridge('),source.indexOf('openFirewall(9999,')),context);
for(const [label,tag,port,rel] of [['Pikafish','PIKAFISH',19989,'pikafish/pikafish-bmi2.exe'],['BF','BRUTEFORCE',19990,'bruteforce-src/src/bruteforce.exe']]){
 const exePath=path.join(root,'engine',rel);context.startBridge({label,crashTag:tag,port,exePath,exeDir:path.dirname(exePath)});
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),isTest=url.pathname==='/__combo-test';
 const target=isTest?path.join(root,'xiangqi-analyzer.html'):path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type',target.endsWith('.wasm')?'application/wasm':target.endsWith('.js')?'text/javascript':target.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');
 fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}
  if(isTest)data=data.toString('utf8').replaceAll('ws://localhost:8899','ws://127.0.0.1:19989').replaceAll('ws://localhost:8900','ws://127.0.0.1:19990')
   .replace('</body>', '<script src="/tests/browser/' + (url.searchParams.has('initial-lines') ? 'analysis-engine-lines.js' : url.searchParams.has('history') ? 'history-test.js' : url.searchParams.has('cache') ? 'cache-repro.js' : 'composite-browser-test.js') + '"></script></body>');
  res.end(data);
 });
});
server.listen(19998,'127.0.0.1',()=>console.log('Composite test: http://127.0.0.1:19998/__combo-test?mode=nativecombo (or webcombo)'));
function cleanup(){closed=true;for(const t of timers)clearTimeout(t);for(const s of sockets){for(const c of s.clients)c.terminate();s.close();}for(const c of children)c.kill();server.close();}
process.on('SIGINT',cleanup);process.on('SIGTERM',cleanup);setTimeout(cleanup,600000).unref();
