'use strict';
// Chẩn đoán: Brute-force trên một FEN với luật chiếu liên tiếp. FEN=... BUDGET=n LIM=n KTC=true|false
const { spawn } = require('child_process');
const path = require('path');
const BF = path.resolve(__dirname, '..', 'engine', 'bruteforce', 'bruteforce.exe');
const p = spawn(BF, [], { cwd: path.dirname(BF) });
let buf = '';
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
  if (/score/.test(l)) console.log(l);
  if (l === 'bruteforceok') p.stdin.write(`setoption name CheckStreak_RestrictedColor value black\nsetoption name CheckStreak_Limit value ${process.env.LIM||2}\nsetoption name CheckStreak_BonusRule value false\nsetoption name KtcBudget value ${process.env.KTC||'true'}\nucinewgame\nposition fen ${process.env.FEN}\ngo budget ${process.env.BUDGET||7}\n`);
  if (l.startsWith('bestmove')) { console.log(l); p.kill(); } } });
p.stdin.write('bruteforce\n');
