const {spawn} = require('node:child_process');
const path = require('node:path');
const fen = '9/5k3/9/9/5C3/9/9/4K4/2c6/C8 w - - 0 1';
async function run(name, commands) {
  await new Promise(resolve => {
    const p = spawn(path.resolve(process.argv[2] || path.join(__dirname, 'binaries/bruteforce.before.exe')), [], {windowsHide:true});
    let output = '';
    p.stdout.on('data', d => output += d);
    p.stderr.on('data', d => output += d);
    p.stdin.on('error', () => {});
    const timer = setTimeout(() => { output += ' TIMEOUT'; p.kill(); }, 3000);
    p.on('close', code => { clearTimeout(timer); console.log(JSON.stringify({name,code,output})); resolve(); });
    p.stdin.end(commands);
  });
}
(async () => {
  await run('EOF during search', `position fen ${fen}\ngo budget 60\n`);
  await run('immediate stop/quit', `position fen ${fen}\ngo budget 60\nstop\nquit\n`);
  await run('invalid square', `position fen ${fen} moves zzzz\ngo budget 1 movetime 100\nquit\n`);
})();
