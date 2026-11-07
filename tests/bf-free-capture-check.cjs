'use strict';
// Chẩn đoán luật "võ tân" (CheckStreak_FreeCapture) trên Brute-force.
// FEN=... BUDGET=n FREE=true|false BONUS=true|false KTC=true|false LIM=n
const { spawn } = require('child_process');
const path = require('path');
const BF = path.resolve(__dirname, '..', 'engine', 'bruteforce', 'bruteforce.exe');
const p = spawn(BF, [], { cwd: path.dirname(BF) });
let buf = '';
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
  if (/score|pv|bestmove/.test(l)) console.log(l);
  if (l === 'bruteforceok') p.stdin.write(`setoption name CheckStreak_RestrictedColor value ${process.env.SIDE||'black'}\nsetoption name CheckStreak_Limit value ${process.env.LIM||2}\nsetoption name CheckStreak_BonusRule value ${process.env.BONUS||'false'}\nsetoption name CheckStreak_FreeCapture value ${process.env.FREE||'false'}\nsetoption name KtcBudget value ${process.env.KTC||'false'}\nucinewgame\nposition fen ${process.env.FEN}${process.env.MOVES ? ' moves ' + process.env.MOVES : ''}\ngo budget ${process.env.BUDGET||7}\n`);
  if (l.startsWith('bestmove')) p.kill(); } });
p.stdin.write('bruteforce\n');
const tm = setTimeout(() => { console.log('TIMEOUT'); p.kill(); }, +(process.env.T||300000)); p.on('exit', () => clearTimeout(tm));
