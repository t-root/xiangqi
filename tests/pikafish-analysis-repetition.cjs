'use strict';
// Luật chiếu liên tiếp của chế độ Phân Tích (chỉ MỘT bên bị giới hạn) không dùng luật "chiếu dai thua"
// chuẩn của Pikafish: thế lặp do chiếu chỉ là hoà, nên bên bị giới hạn có thể lặp bằng cách luân phiên
// quân chiếu. Thế A (Đen luân phiên Mã chiếu lộ e1d1 và Tốt chiếu d1e1) phải ra mate 10 ở giới hạn 2,
// khớp Brute-force; bản Pikafish chưa sửa báo mate 9 vì phạt thua vòng lặp đó.
// NGOẠI LỆ (position.cpp, rule_judge): khi quân chiếu của bên bị giới hạn đã dùng hết số lần chiếu cho
// phép thì không phán gì ở thế lặp, để tìm kiếm chạm giới hạn rồi phạt như app. Thế C (Xe Đen chiếu
// liên tiếp) trước đây báo HOÀ vì bị cắt sớm bằng "hoà"; nay phải ra mate 15 (Brute-force chứng minh 15,
// web cũng 15). GIỚI HẠN ĐÃ BIẾT: tìm sâu hơn (độ sâu ~150+) thế C có thể hạ xuống mate 14, ngắn hơn
// Brute-force một nước — chưa xác định nguyên nhân; bài này chỉ chạy tới độ sâu 40.
// Chế độ Duyệt & Điều Khiển (cả hai bên) và khi luật tắt phải giữ nguyên hành vi chuẩn.
// Dùng PIKA_EXE=... để thử bản khác engine/pikafish/pikafish-bmi2.exe.
const { spawn } = require('child_process');
const path = require('path');
const PIKA = process.env.PIKA_EXE || path.resolve(__dirname, '..', 'engine', 'pikafish', 'pikafish-bmi2.exe');
const EVAL = path.resolve(__dirname, '..', 'engine', 'pikafish', 'pikafish.nnue');
const FEN_A = '5k3/4Pc3/3P5/9/9/9/9/5K3/4p4/3pn4 w - - 0 1';
const FEN_C = '2P3R2/4r4/3k5/9/9/9/9/5K3/9/9 w - - 0 1';

function mateOf(FEN, color, limit) {
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
    ['Phân Tích: chỉ Đen, giới hạn 1', FEN_A, 'black', 1, 5],
    ['Phân Tích: chỉ Đen, giới hạn 2 (lặp có chiếu = hoà)', FEN_A, 'black', 2, 10],
    ['Duyệt & Điều Khiển: cả hai bên, giới hạn 3 (giữ nguyên chuẩn)', FEN_A, 'both', 3, 11],
    ['Luật tắt (giữ nguyên chuẩn)', FEN_A, 'none', 2, 12],
    ['Phân Tích thế C (Xe Đen chiếu): không được hoà, mate 15', FEN_C, 'black', 2, 15],
    // Không thêm bài "luật tắt thế C": Pikafish chuẩn ra mate 16 ở độ sâu 40 và chỉ về 15 ở độ sâu ~197.
  ];
  let fail = 0;
  for (const [name, fen, color, limit, want] of cases) {
    const got = await mateOf(fen, color, limit);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: mate ${got} (cần ${want})`);
  }
  console.log(fail ? `${fail} bài lỗi` : 'Tất cả đạt');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
