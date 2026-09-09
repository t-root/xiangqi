const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const engineDir = path.resolve(__dirname, '../engine');
const executable = path.resolve(process.argv[2] || path.join(engineDir, 'bruteforce-src/src/bruteforce.exe'));
const fen = '9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1';
const opening = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function launch(exe = executable, cwd = path.dirname(exe)) {
  const child = spawn(exe, [], {cwd, windowsHide:true});
  const lines = []; let buffer = '', stderr = '';
  child.stdout.on('data', d => { buffer += d; const a = buffer.split(/\r?\n/); buffer = a.pop(); lines.push(...a); });
  child.stderr.on('data', d => stderr += d);
  child.stdin.on('error', () => {});
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
  const guard = setTimeout(() => child.kill(), 12000);
  return {
    child, lines, send: s => child.stdin.write(s + '\n'),
    async wait(predicate, ms = 4000, from = 0) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = lines.slice(from).find(predicate);
        if (hit) return hit;
        if (child.exitCode !== null) throw Error(`exit ${child.exitCode}: ${stderr} ${lines.join('\n')}`);
        await new Promise(r => setTimeout(r, 5));
      }
      throw Error('response timeout: ' + lines.slice(-10).join('\n'));
    },
    async finish(commands = 'quit\n') {
      child.stdin.end(commands);
      const code = await closed; clearTimeout(guard); assert.equal(code, 0, stderr);
    },
  };
}
function bridgeFixture() {
  const source = fs.readFileSync(path.join(engineDir, 'server.js'), 'utf8');
  const children = [], timers = [];
  let server;
  class WSS extends EventEmitter { constructor() { super(); server = this; } }
  const spawnMock = () => {
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.stdin = new EventEmitter(); c.stdin.destroyed = false; c.writes = [];
    c.stdin.write = s => c.writes.push(s); c.killed = false; c.exitCode = null;
    c.kill = () => { c.killed = true; }; children.push(c); return c;
  };
  const context = {spawn:spawnMock, WebSocketServer:WSS, killPortIfBusy(){}, getLocalIP(){return 'localhost';},
    console:{log(){},warn(){},error(){}}, setTimeout:f => {timers.push(f);return f;}, clearTimeout:f=>{ const i=timers.indexOf(f);if(i>=0)timers.splice(i,1); }};
  vm.runInNewContext(source.slice(source.indexOf('function startBridge('), source.indexOf("openFirewall(9999,")) +
    "\nstartBridge({label:'BF',crashTag:'BRUTEFORCE',port:0,exePath:'test',exeDir:'.'});", context);
  const connect = () => { const ws = new EventEmitter(); ws.OPEN=1;ws.readyState=1;ws.messages=[];
    ws.send=s=>ws.messages.push(s);ws.close=()=>{ws.readyState=3;};server.emit('connection',ws);return ws; };
  return {children,timers,connect};
}
(async () => {
  await test('EOF joins live worker', async () => { const p=launch(); await p.finish(`position fen ${opening}\ngo budget 60\n`); });
  await test('immediate stop is never overwritten (40 searches)', async () => {
    const p=launch(); const t=Date.now();
    p.send(`position fen ${opening}`);
    for(let i=0;i<40;i++) p.send('go budget 60\nstop');
    await p.finish(); assert(Date.now()-t<6000); assert.equal(p.lines.filter(s=>s.startsWith('bestmove')).length,40);
  });
  await test('malformed input rejects safely and engine recovers', async () => {
    const p=launch();
    for(const bad of ['zzzz','a:a0','a0j0','a0a0','a0a1extra','a1a2']) {
      const n=p.lines.length;p.send(`position fen ${fen} moves ${bad}\nisready`);
      await p.wait(s=>s==='readyok',4000,n);assert(p.lines.slice(n).some(s=>s.includes('ERROR:')));
    }
    for(const bad of ['9 w','99/9/9/9/9/9/9/9/9/9 w','9/9/9/9/9/9/9/9/9/9/ w']) {
      const n=p.lines.length;p.send(`position fen ${bad}\nisready`);await p.wait(s=>s==='readyok',4000,n);
      assert(p.lines.slice(n).some(s=>s.includes('ERROR:')));
    }
    p.send(`position fen ${fen}\ngo budget 4 movetime 2000`);
    await p.wait(s=>s.startsWith('bestmove a0f0'));await p.finish();
  });
  await test('newgame synchronizes history with positional search', async () => {
    const p=launch();p.send(`position fen ${opening}`);
    for(let i=0;i<30;i++) p.send('go positional depth 12 movetime 1000\nucinewgame');
    await p.finish();
  });
  await test('search depth and duration bounds', async () => {
    const p=launch();p.send(`position fen ${fen}`);
    for(const command of ['go budget 2147483647','go budgets red 2147483647 black 2','go positional depth 2147483647','go budget 2 movetime 9223372036854775807']) {
      const n=p.lines.length;p.send(command);await p.wait(s=>s.startsWith('bestmove'),4000,n);
      assert(p.lines.slice(n).some(s=>s.includes('ERROR:')));
    }
    await p.finish();
  });
  await test('positional movetime and stop remain responsive', async () => {
    const p=launch();p.send(`position fen ${opening}`);
    const t=Date.now();p.send('go positional depth 12 movetime 30');await p.wait(s=>s.startsWith('bestmove'),2000);
    assert(Date.now()-t<1000);await p.finish();
  });
  await test('session cap and explicit release', async () => {
    const p=launch();p.send(`position fen ${fen}`);
    for(let i=0;i<18;i++)p.send('search create job'+i);
    p.send('isready');await p.wait(s=>s==='readyok');
    assert.equal(p.lines.filter(s=>s.includes('limit reached')).length,2);
    const n=p.lines.length;p.send('search cancel job0\nsearch create replacement\nsearch slice replacement budget 4 movetime 2000');
    await p.wait(s=>s==='bestmove a0f0',4000,n);await p.finish();
  });
  await test('warm slices agree with fresh search', async () => {
    const p=launch();p.send(`position fen ${fen}\nsearch create warm`);
    let done=false;
    for(let i=0;i<40&&!done;i++) { const n=p.lines.length;p.send('search slice warm budget 4 movetime 40');
      const best=await p.wait(s=>s.startsWith('bestmove'),4000,n);done=best==='bestmove a0f0'; }
    assert(done,'warm search must converge to mate');await p.finish();
  });
  await test('bridge catches spawn failure without duplicate restart', () => {
    const f=bridgeFixture(),ws=f.connect(),c=f.children[0];c.emit('error',{code:'ENOENT'});c.emit('close',-4058,null);
    assert.equal(f.timers.length,1);assert(ws.messages.some(s=>s.includes('BRUTEFORCE_CRASHED')));
  });
  await test('bridge catches broken stdin and recovers', () => {
    const f=bridgeFixture(),ws=f.connect(),c=f.children[0];ws.emit('message',Buffer.from('go budget 4'));
    c.stdin.emit('error',{code:'EPIPE'});assert(c.killed);assert.equal(f.timers.length,1);
    f.timers.shift()();assert.equal(f.children.length,2);
    c.stdout.emit('data',Buffer.from('bestmove stale\n'));assert(!ws.messages.includes('bestmove stale'));
  });
  await test('bridge tracks sessions and kills abandoned search', () => {
    const f=bridgeFixture(),ws=f.connect(),c=f.children[0];ws.emit('message',Buffer.from('search slice job budget 4 movetime 200'));
    ws.emit('close');assert(c.killed);
  });
  await test('real WebSocket bridge: search, stop barrier, engine crash and restart', async () => {
    const {WebSocketServer,WebSocket}=require('../engine/node_modules/ws');
    const source=fs.readFileSync(path.join(engineDir,'server.js'),'utf8');
    let wss,closed=false;const children=[],timers=new Set();
    const context={console:{log(){},warn(){},error(){}},killPortIfBusy(){},getLocalIP(){return 'localhost';},
      spawn:(...args)=>{const c=spawn(...args);children.push(c);return c;},
      WebSocketServer:class extends WebSocketServer {constructor(){super({port:0,host:'127.0.0.1'});wss=this;}},
      setTimeout:(fn,ms)=>{if(closed)return 0;const t=setTimeout(fn,ms);timers.add(t);return t;},clearTimeout};
    vm.runInNewContext(source.slice(source.indexOf('function startBridge('),source.indexOf('openFirewall(9999,'))+
      '\nstartBridge('+JSON.stringify({label:'BF',crashTag:'BRUTEFORCE',port:0,exePath:executable,exeDir:path.dirname(executable)})+');',context);
    await new Promise(r=>wss.once('listening',r));
    const ws=new WebSocket('ws://127.0.0.1:'+wss.address().port);const messages=[];
    ws.on('message',d=>messages.push(String(d)));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
    const wait=async(pred,from=0)=>{for(let i=0;i<1000;i++){if(messages.slice(from).some(pred))return;await new Promise(r=>setTimeout(r,5));}throw Error('WebSocket timeout '+messages.slice(-8));};
    try {
      ws.send(`position fen ${opening}\ngo budget 60\nsetoption name Threads value 1\nisready`);
      await wait(s=>s==='readyok');assert(messages.some(s=>s.startsWith('bestmove')));
      const n=messages.length;children[0].kill();await wait(s=>s.includes('BRUTEFORCE_CRASHED'),n);
      ws.send(`position fen ${fen}\ngo budget 4 movetime 2000`);
      await wait(s=>s==='bestmove a0f0',n);assert.equal(children.length,2);
    } finally {closed=true;for(const t of timers)clearTimeout(t);ws.terminate();wss.close();for(const c of children)c.kill();}
  });
  await test('replaced WebSocket cannot submit commands', () => {
    const f=bridgeFixture(),old=f.connect();f.connect();const c=f.children[0],n=c.writes.length;
    old.emit('message',Buffer.from('go budget 60'));assert.equal(c.writes.length,n);
  });
  await test('bridge waits for bestmove before changing engine state', () => {
    const f=bridgeFixture(),ws=f.connect(),c=f.children[0];
    ws.emit('message',Buffer.from('go infinite\nposition fen test\nisready\ngo depth 2'));
    assert.deepEqual(c.writes,['go infinite\n','stop\n']);
    c.stdout.emit('data',Buffer.from('bestmove a0a1\n'));
    assert.deepEqual(c.writes,['go infinite\n','stop\n','position fen test\n','isready\n','go depth 2\n']);
    ws.emit('close');assert(c.killed);
  });
  await test('HTML inline scripts and bridge parse', () => {
    const html=fs.readFileSync(path.join(__dirname,'../xiangqi-analyzer.html'),'utf8');
    for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
    new vm.Script(fs.readFileSync(path.join(engineDir,'server.js'),'utf8'));
  });
  const pika=path.join(engineDir,'pikafish/pikafish-bmi2.exe');
  await test('Pikafish native handshake, search, stop, EOF', async () => {
    const p=launch(pika);p.send('uci');await p.wait(s=>s==='uciok');
    p.send('setoption name Threads value 1\nisready');await p.wait(s=>s==='readyok',8000);
    p.send('position startpos\ngo movetime 50');await p.wait(s=>s.startsWith('bestmove'),8000);
    await p.finish('go infinite\nstop\n');
  });
  console.log(`PASS ${passed} regression groups`);
})().catch(error=>{console.error(error);process.exitCode=1;});
