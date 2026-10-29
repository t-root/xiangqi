'use strict';
// Chẩn đoán: chạy Pikafish ktc tắt/bật trên một FEN. FEN=... ATT=white|black DEPTH=n
const { spawn } = require('child_process');
const path = require('path');
const PIKA = process.env.PIKA_EXE || path.resolve(__dirname, '..', 'engine', 'pikafish', 'pikafish-bmi2.exe');
const FEN = process.env.FEN, ATT = process.env.ATT || 'white', DEPTH = process.env.DEPTH || 30;
function run(ktc) {
  return new Promise(res => {
    const p = spawn(PIKA, [], { cwd: path.dirname(PIKA) });
    let buf = '', last = '';
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (/ score /.test(l) && / pv /.test(l)) { last = l; if (process.env.V) console.log(ktc?'ON ':'OFF', l.slice(0,60), l.split(' pv ')[1]); }
      if (l === 'readyok') { p.stdin.write(`position fen ${FEN}${process.env.MOVES?" moves "+process.env.MOVES:""}\ngo depth ${DEPTH}\n`); }
      if (l.startsWith('bestmove')) { p.kill(); res(last); } } });
    p.stdin.write(`uci\nsetoption name Hash value 256\nsetoption name CheckStreak_RestrictedColor value black
setoption name CheckStreak_Limit value ${process.env.LIM||3}
setoption name CheckStreak_BonusRule value false
setoption name KtcBudget value ${ktc}\nsetoption name KtcAttacker value ${ktc ? ATT : 'none'}\nucinewgame\nisready\n`);
  });
}
(async () => { console.log('OFF', await run(false)); console.log('ON ', await run(true)); })();
