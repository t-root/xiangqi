'use strict';
// Máy khách tối thiểu nói chuyện với bruteforce.exe qua stdin/stdout, dùng chung cho các bài đo
// và đối chiếu bộ tìm mate (tests/bf-rewrite). Không dùng cầu nối WebSocket của server.js.
const { spawn } = require('child_process');
const readline = require('readline');

class BfClient {
  constructor(exe, options = {}) {
    this.exe = exe;
    this.proc = spawn(exe, [], { stdio: ['pipe', 'pipe', process.env.BF_STDERR ? 'inherit' : 'ignore'] });
    this.lines = [];
    this.waiters = [];
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', line => {
      this.lines.push(line);
      for (const w of [...this.waiters]) w(line);
    });
    this.closed = false;
    this.proc.on('exit', () => {
      this.closed = true;
      for (const w of [...this.waiters]) w(null);
    });
    this.send('bruteforce');
    this.send('setoption name Threads value ' + (options.threads || 1));
    if (options.hashReserveMiB !== undefined) this.send('setoption name HashReserveMiB value ' + options.hashReserveMiB);
    this.send('setoption name CheckStreak_RestrictedColor value ' + (options.restricted || 'none'));
    this.send('setoption name CheckStreak_Limit value ' + (options.limit || 2));
    this.send('setoption name KtcBudget value ' + (options.ktc ? 'true' : 'false'));
    if (options.extra) for (const cmd of options.extra) this.send(cmd);
  }
  send(cmd) { this.proc.stdin.write(cmd + '\n'); }
  // Chờ tới khi gặp một dòng thỏa predicate (hoặc tiến trình thoát / quá giờ).
  waitFor(pred, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
      const waiter = line => {
        if (line === null) { cleanup(); reject(new Error('process exited')); return; }
        if (pred(line)) { cleanup(); resolve(line); }
      };
      const cleanup = () => {
        clearTimeout(timer);
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
      };
      this.waiters.push(waiter);
    });
  }
  async ready() {
    this.send('isready');
    await this.waitFor(l => l.trim() === 'readyok');
  }
  // Gửi position + một lệnh go, trả về mọi dòng sinh ra từ lúc gửi tới bestmove.
  async go(positionCmd, goCmd, timeoutMs = 600000) {
    await this.ready();
    const start = this.lines.length;
    this.send(positionCmd);
    this.send(goCmd);
    await this.waitFor(l => l.indexOf('bestmove') === 0, timeoutMs);
    return parseGoOutput(this.lines.slice(start));
  }
  quit() {
    try { this.send('quit'); } catch (_) { /* đã đóng */ }
    setTimeout(() => { try { this.proc.kill(); } catch (_) { /* đã thoát */ } }, 300);
  }
}

function parseGoOutput(lines) {
  const infos = [];
  let bestmove = null, outcome = null;
  for (const line of lines) {
    if (line.indexOf('info depth') === 0) {
      const d = line.match(/\bdepth (\d+)/), s = line.match(/score (cp|mate) (-?\d+)/);
      const n = line.match(/\bnodes (\d+)/), t = line.match(/\btime (\d+)/), pv = line.match(/ pv (.+)$/);
      infos.push({
        depth: d ? +d[1] : 0, scoreType: s ? s[1] : null, scoreVal: s ? +s[2] : 0,
        nodes: n ? +n[1] : 0, time: t ? +t[1] : 0, pv: pv ? pv[1].trim().split(' ') : []
      });
    } else if (line.indexOf('info string outcome') === 0) {
      outcome = line.split(' ').pop();
    } else if (line.indexOf('bestmove') === 0) {
      bestmove = line.split(' ')[1] || null;
    }
  }
  return { infos, bestmove, outcome, raw: lines };
}

module.exports = { BfClient, parseGoOutput };
