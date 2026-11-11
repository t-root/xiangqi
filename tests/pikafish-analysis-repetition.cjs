'use strict';
// Luật chiếu liên tiếp của chế độ Phân Tích (chỉ MỘT bên bị giới hạn) không dùng luật "chiếu dai thua"
// chuẩn của Pikafish: thế lặp do chiếu chỉ là hoà, nên bên bị giới hạn có thể lặp bằng cách luân phiên
// quân chiếu. Thế dưới đây (Đen luân phiên Mã chiếu lộ e1d1 và Tốt chiếu d1e1) phải ra mate 10 ở giới
// hạn 2, khớp Brute-force; bản Pikafish chưa sửa báo mate 9 vì phạt thua vòng lặp đó.
// Chế độ Duyệt & Điều Khiển (cả hai bên) và khi luật tắt phải giữ nguyên hành vi chuẩn.
// Dùng PIKA_EXE=... để thử bản khác engine/pikafish/pikafish-bmi2.exe.
const { spawn } = require('child_process');
const path = require('path');
const PIKA = process.env.PIKA_EXE || path.resolve(__dirname, '..', 'engine', 'pikafish', 'pikafish-bmi2.exe');
const EVAL = path.resolve(__dirname, '..', 'engine', 'pikafish', 'pikafish.nnue');
const FEN = '5k3/4Pc3/3P5/9/9/9/9/5K3/4p4/3pn4 w - - 0 1';

function mateOf(color, limit) {
  return new Promise((resolve, reject) => {
    const p = spawn(PIKA, [], { cwd: path.dirname(PIKA) });
    let buf = '', last = null;
    const timer = setTimeout(() => { p.kill(); reject(new Error('quá thời gian')); }, 120000);
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const m = l.match(/ score (cp|mate) (-?\d+).* pv /);
        if (m) last = m[1] === 'mate' ? Number(m[2]) : null;
        if (l === 'readyok') p.stdin.write(`position fen ${FEN}\ngo depth 40\n`);
        if (l.startsWith('bestmove')) { clearTimeout(timer); p.kill(); resolve(last); }
      }
    });
    p.stdin.write(`uci\nsetoption name EvalFile value ${EVAL}\nsetoption name Hash value 128\n` +
      `setoption name CheckStreak_RestrictedColor value ${color}\nsetoption name CheckStreak_Limit value ${limit}\n` +
      `setoption name CheckStreak_BonusRule value false\nucinewgame\nisready\n`);
  });
}

(async () => {
  const cases = [
    ['Phân Tích: chỉ Đen, giới hạn 1', 'black', 1, 5],
    ['Phân Tích: chỉ Đen, giới hạn 2 (lặp có chiếu = hoà)', 'black', 2, 10],
    ['Duyệt & Điều Khiển: cả hai bên, giới hạn 3 (giữ nguyên chuẩn)', 'both', 3, 11],
    ['Luật tắt (giữ nguyên chuẩn)', 'none', 2, 12],
  ];
  let fail = 0;
  for (const [name, color, limit, want] of cases) {
    const got = await mateOf(color, limit);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: mate ${got} (cần ${want})`);
  }
  console.log(fail ? `${fail} bài lỗi` : 'Tất cả đạt');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
