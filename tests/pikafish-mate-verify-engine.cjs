'use strict';
// Chạy ĐÚNG mã xác minh biến mate trong xiangqi-analyzer.html (verifyPikafishMatePv) với Pikafish thật qua một
// "websocket giả" bọc tiến trình engine. Ca thật: thế 2P3R2/4r4/3k5/9/9/9/9/5K3/9/9 w, luật Phân Tích (Đen giới
// hạn 2). Tìm sâu ra biến mate 14, nhưng tìm lại từng thế dọc biến cho thấy số đúng là 15 (khớp Brute-force và
// web). Test này giữ cho bước xác minh bắt được loại mâu thuẫn đó.
// Dùng PIKA_EXE=... để thử bản khác engine/pikafish/pikafish-bmi2.exe.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const parser = require('../engine/node_modules/@babel/parser');

const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const fns = new Map();
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const n of parser.parse(m[1]).program.body) {
        if (n.type === 'FunctionDeclaration') fns.set(n.id.name, m[1].slice(n.start, n.end));
    }
}
const PIKA = process.env.PIKA_EXE || path.resolve(__dirname, '..', 'engine', 'pikafish', 'pikafish-bmi2.exe');
const FEN = '2P3R2/4r4/3k5/9/9/9/9/5K3/9/9 w - - 0 1';
// Biến mate 14 mà Pikafish đã báo ở thế này (27 nước).
const PV = ('g9f9 e8h8 f9e9 h8h0 f2f1 h0h1 f1f0 h1h0 f0f1 h0h8 f1e1 h8h1 e1e0 h1h8 e9e6 h8h0 e0e1 h0h1 e1e0 h1d1 ' +
    'e6e9 d1d0 e0e1 d0d1 e1e0 d1d2 e9d9').split(' ');

async function main() {
    const proc = spawn(PIKA, [], { cwd: path.dirname(PIKA) });
    // Engine thoát giữa chừng thì báo lỗi rõ ràng, không để lời hứa treo rồi Node thoát im lặng.
    const engineDied = new Promise((_, reject) => {
        proc.on('exit', (code, signal) => { if (code !== null) reject(new Error('Pikafish thoát bất ngờ, mã ' + code)); });
        proc.on('error', reject);
    });
    const msgHandlers = new Set(), closeHandlers = new Set();
    let buf = '';
    proc.stdout.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (line) for (const f of [...msgHandlers]) f({ data: line });
        }
    });
    const ws = {
        send: line => proc.stdin.write(line + '\n'),
        addEventListener: (t, f) => (t === 'message' ? msgHandlers : closeHandlers).add(f),
        removeEventListener: (t, f) => (t === 'message' ? msgHandlers : closeHandlers).delete(f)
    };
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, Math, Number, Array, Promise, Error, Date,
        document: { getElementById: () => null } });
    vm.runInContext('let pikafishMsgHandler = null, pikafishActiveWs = null, analysisCancelled = false;' +
        'let ktcBudgetOn = false, ktcExemptColor = null, checkStreakBonusRuleOn = false, checkStreakFreeCaptureRuleOn = false;' +
        'const PIKAFISH_MAX_SEARCH_DEPTH = 245;', ctx);
    for (const name of ['planMatePvVerification', 'reconcileMatePvClaim', 'waitForPikafishLine',
        'pikafishAttachHandler', 'pikafishDetachHandler', 'pikafishMateVerifyDepth',
        'pikafishMateVerifyBudgetMs', 'pikafishFreshNodeMatedIn', 'verifyPikafishMatePv',
        'mateVerifyMaxMs', 'mateVerifyRuleAdapters', 'unknownActiveMateVerifyRules', 'buildKtcFreeMoveFlags',
        'buildCorrectedMatePv', 'otherSide']) {
        assert.ok(fns.has(name), `thiếu hàm ${name}`);
        vm.runInContext(fns.get(name), ctx);
    }
    try {
        await Promise.race([engineDied, (async () => {
        ws.send('uci');
        for (const o of ['Threads value 4', 'Hash value 256', 'CheckStreak_RestrictedColor value black',
            'CheckStreak_Limit value 2', 'CheckStreak_BonusRule value false',
            'CheckStreak_RootRed value none', 'CheckStreak_RootBlack value none']) ws.send('setoption name ' + o);
        ws.send('ucinewgame');
        const ready = ctx.waitForPikafishLine(ws, l => l.trim() === 'readyok', 15000);
        ws.send('isready');
        await ready;
        const info = { scoreType: 'mate', scoreVal: 14, pv: PV };
        const resultEl = { innerHTML: '' };
        const progress = [];
        const out = await ctx.verifyPikafishMatePv(ws, info, {}, { positionCommand: 'position fen ' + FEN }, resultEl,
            p => progress.push(`${p.current}/${p.total}`));
        assert.ok(out, 'phải có kết quả xác minh');
        // Tiến độ riêng báo lần lượt từng thế để giao diện hiện "đang hiệu chỉnh thế k/n".
        assert.deepEqual(progress, Array.from({ length: 13 }, (_, i) => `${i + 1}/13`));
        assert.equal(out.rec.checked, 13, 'phải tìm lại đủ 13 thế dọc biến');
        assert.equal(out.rec.missing, 0, 'không được có thế nào chưa xác minh được');
        assert.equal(out.info.scoreVal, 15, 'biến báo 14 phải được hiệu chỉnh thành 15');
        assert.equal(out.info.preVerifyScoreVal, 14, 'phải giữ số trước hiệu chỉnh để dòng "Từng engine" hiển thị');
        assert.match(out.info.verifyNote, /14/);
        assert.match(out.info.verifyNote, /15/);
        // Số đã nâng thì BIẾN cũng phải dựng lại theo số mới, không được còn là biến 14 cũ (27 nước):
        // nước đầu giữ nguyên, dài đúng 2*15-1 = 29 nửa nước, khác biến cũ, và kết thúc bằng chiếu bí thật.
        const fixed = out.info.pv;
        assert.equal(fixed[0], PV[0], 'nước đầu của biến phải giữ nguyên');
        assert.notDeepEqual(fixed, PV, 'biến phải được dựng lại, không còn là biến 14 cũ');
        assert.equal(fixed.length, 2 * 15 - 1, 'biến dựng lại phải dài đúng 2N-1 nửa nước của số mới');
        const mated = ctx.waitForPikafishLine(ws, l => l.startsWith('bestmove'), 15000);
        ws.send('position fen ' + FEN + ' moves ' + fixed.join(' '));
        ws.send('go depth 1');
        assert.match(await mated, /bestmove \(none\)/, 'sau biến dựng lại bên thua phải bị chiếu bí');
        console.log('PASS xác minh biến mate với Pikafish thật: báo 14 -> hiệu chỉnh 15');
        })()]);
    } finally {
        proc.kill();
    }
}
// Không gọi process.exit khi thành công: trên Windows nó có thể cắt mất dòng PASS đang ghi ra ống. Tiến
// trình Pikafish đã bị kill trong finally nên Node tự thoát.
main().catch(e => { console.error(e); process.exitCode = 1; });
