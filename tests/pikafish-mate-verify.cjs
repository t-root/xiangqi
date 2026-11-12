'use strict';
// Tự xác minh biến mate của Pikafish (xiangqi-analyzer.html): planMatePvVerification lập danh sách thế
// "bên thua đến lượt" dọc biến, reconcileMatePvClaim đối chiếu kết quả tìm lại với số nước còn lại.
// Ca thật đã gặp (thế 2P3R2/4r4/3k5/..., luật Phân Tích): biến báo mate 14 nhưng tìm lại ở thế sau 19 nước
// của biến ra "mate -5" thay vì -4 -> số đúng là 15.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');

const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const functions = new Map();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration') functions.set(node.id.name, match[1].slice(node.start, node.end));
    }
}
for (const name of ['planMatePvVerification', 'reconcileMatePvClaim', 'buildKtcFreeMoveFlags',
    'mateVerifyRuleAdapters', 'unknownActiveMateVerifyRules', 'mateVerifyMaxMs', 'buildCorrectedMatePv']) {
    assert.ok(functions.has(name), `thiếu hàm ${name}`);
}
const ctx = vm.createContext({});
vm.runInContext(functions.get('planMatePvVerification'), ctx);
vm.runInContext(functions.get('reconcileMatePvClaim'), ctx);
vm.runInContext(functions.get('buildCorrectedMatePv'), ctx);
vm.runInContext(functions.get('buildKtcFreeMoveFlags'), ctx);
vm.runInContext(functions.get('mateVerifyMaxMs'), ctx);
const plan = (s, pv, flags) => JSON.parse(JSON.stringify(ctx.planMatePvVerification(s, pv, flags)));
const rec = (s, n, r, unit) => ctx.reconcileMatePvClaim(s, JSON.parse(JSON.stringify(n)), r, unit);
const pvOf = len => Array.from({ length: len }, (_, i) => 'm' + i);

// 1) Bên đi trước thắng, mate 14, biến đủ 27 nước: 13 thế (sau 1,3,...,25 nước), còn 13,12,...,1 nước.
{
    const nodes = plan(14, pvOf(27));
    assert.equal(nodes.length, 13);
    assert.deepEqual(nodes[0], { prefixLen: 1, remaining: 13 });
    assert.deepEqual(nodes[12], { prefixLen: 25, remaining: 1 });
    assert.deepEqual(nodes.map(n => n.prefixLen), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]);
}
// 2) Bên đi trước bị chiếu bí (scoreVal < 0): nước đầu của biến là của bên thua; thế tính sau mỗi nước bên thắng.
{
    const nodes = plan(-3, pvOf(5));
    assert.deepEqual(nodes, [{ prefixLen: 2, remaining: 2 }, { prefixLen: 4, remaining: 1 }]);
}
// 3) Biến bị cắt ngắn: chỉ lập các thế nằm trong biến; mate 1 hoặc không có biến thì không có thế nào.
assert.deepEqual(plan(14, pvOf(6)), [{ prefixLen: 1, remaining: 13 }, { prefixLen: 3, remaining: 12 }, { prefixLen: 5, remaining: 11 }]);
assert.deepEqual(plan(1, pvOf(1)), []);
assert.deepEqual(plan(0, pvOf(5)), []);
assert.deepEqual(plan(5, null), []);

// 4) Mọi thế khớp: không đổi số, ghi chú "đã tìm lại ... khớp".
{
    const nodes = plan(14, pvOf(27));
    const results = nodes.map(n => ({ matedIn: n.remaining }));
    const r = rec(14, nodes, results);
    assert.equal(r.total, 14);
    assert.equal(r.delta, 0);
    assert.equal(r.checked, 13);
    assert.match(r.note, /khớp/);
}
// 5) Ca thật: thế sau 19 nước (còn 4) tìm lại ra 5 -> các thế phía trước phải kỳ vọng +1 -> số đúng 15.
{
    const nodes = plan(14, pvOf(27));
    const results = nodes.map(n => ({ matedIn: n.remaining <= 3 ? n.remaining : n.remaining + 1 }));
    const r = rec(14, nodes, results);
    assert.equal(r.total, 15);
    assert.equal(r.delta, 1);
    assert.match(r.note, /14/);
    assert.match(r.note, /15/);
}
// 6) Tìm lại ra mate NGẮN hơn số tuyên bố: vẫn khớp ("tối đa N" đúng), không đổi số.
{
    const nodes = plan(14, pvOf(27));
    const results = nodes.map(n => ({ matedIn: Math.max(1, n.remaining - 1) }));
    const r = rec(14, nodes, results);
    assert.equal(r.total, 14);
    assert.equal(r.delta, 0);
}
// 7) Có thế không thấy mate khi tìm lại (null): không tự hạ/nâng số, nhưng ghi rõ chưa xác minh hết.
{
    const nodes = plan(14, pvOf(27));
    const results = nodes.map((n, i) => ({ matedIn: i === 4 ? null : n.remaining }));
    const r = rec(14, nodes, results);
    assert.equal(r.total, 14);
    assert.equal(r.checked, 12);
    assert.equal(r.missing, 1);
    assert.match(r.note, /12\/13/);
}
// 8) Hai chỗ lệch ở hai thế khác nhau: cộng dồn đúng.
{
    const nodes = plan(10, pvOf(19));
    // thế cuối (còn 1) khớp; thế còn 3 ra 4 (+1); thế còn 6 phải kỳ vọng 7, ra 9 (+2 nữa)
    const results = nodes.map(n => {
        if (n.remaining === 3) return { matedIn: 4 };
        if (n.remaining === 6) return { matedIn: 9 };
        if (n.remaining > 6) return { matedIn: n.remaining + 3 };
        if (n.remaining > 3) return { matedIn: n.remaining + 1 };
        return { matedIn: n.remaining };
    });
    const r = rec(10, nodes, results);
    assert.equal(r.total, 13);
    assert.equal(r.delta, 3);
}

// 8a) Số bị nâng thì BIẾN cũng phải dựng lại theo số mới: phần đầu của biến cũ tới thế lệch GẦN GỐC NHẤT, nối với
//     biến tìm lại ở thế đó. Đúng ca thật: biến báo 14 (27 nước), thế sau 3 nước tìm lại ra 13 (kỳ vọng 12),
//     thế sau 1 nước ra 14 (khớp sau khi cộng 1) -> số 15, biến = 3 nước đầu cũ + biến tìm lại (26 nước).
{
    const pv = pvOf(27);
    const nodes = plan(14, pv);
    const fresh3 = Array.from({ length: 26 }, (_, i) => 'f' + i);
    const results = nodes.map(n => {
        if (n.prefixLen === 3) return { matedIn: 13, pv: fresh3 };
        if (n.prefixLen === 1) return { matedIn: 14, pv: ['x'] };
        return { matedIn: n.remaining, pv: ['y'] };
    });
    const r = rec(14, nodes, results);
    assert.equal(r.total, 15);
    assert.equal(nodes[r.raisedIdx].prefixLen, 3, 'thế bị nâng gần gốc nhất là thế sau 3 nước');
    const fixed = JSON.parse(JSON.stringify(ctx.buildCorrectedMatePv(pv, nodes, results, r.raisedIdx)));
    assert.deepEqual(fixed, ['m0', 'm1', 'm2', ...fresh3]);
    assert.equal(fixed.length, 2 * 15 - 1, 'biến dựng lại dài đúng 2N-1 nửa nước của số mới');
    // Hai chỗ nâng: lấy chỗ gần gốc nhất (biến tìm lại ở đó đã gồm mọi chỗ lệch phía sau).
    const results2 = nodes.map(n => {
        if (n.prefixLen === 1) return { matedIn: 16, pv: ['near-root'] };
        if (n.prefixLen === 7) return { matedIn: 12, pv: ['deeper'] };
        return { matedIn: n.remaining, pv: ['y'] };
    });
    const r2 = rec(14, nodes, results2);
    assert.equal(nodes[r2.raisedIdx].prefixLen, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.buildCorrectedMatePv(pv, nodes, results2, r2.raisedIdx))), ['m0', 'near-root']);
    // Không nâng thì không có biến để dựng lại; thiếu biến tìm lại thì trả null (người gọi chỉ giữ nước đầu).
    assert.equal(rec(14, nodes, nodes.map(n => ({ matedIn: n.remaining }))).raisedIdx, -1);
    assert.equal(ctx.buildCorrectedMatePv(pv, nodes, nodes.map(() => ({ matedIn: 99, pv: null })), 0), null);
}
// 8b) ktc: nước MIỄN của bên thắng (Tướng chạy né chiếu) không tính. Biến 7 nước, tổng 3 nước tính đòn:
//     nước 0 (thắng, tính), 2 (thắng, MIỄN), 4 (thắng, tính), 6 (thắng, tính chiếu bí).
{
    const flags = [false, false, true, false, false, false, false];
    const nodes = plan(3, pvOf(7), flags);
    assert.deepEqual(nodes, [
        { prefixLen: 1, remaining: 2 },
        { prefixLen: 3, remaining: 2 },   // sau nước MIỄN: số còn lại không đổi
        { prefixLen: 5, remaining: 1 }
    ]);
    // Không có cờ MIỄN thì cùng biến cho số khác (đếm mọi nước): chứng tỏ cờ có tác dụng.
    assert.deepEqual(plan(4, pvOf(7)), [
        { prefixLen: 1, remaining: 3 }, { prefixLen: 3, remaining: 2 }, { prefixLen: 5, remaining: 1 }
    ]);
    const r = rec(3, nodes, nodes.map(n => ({ matedIn: n.remaining + (n.remaining === 1 ? 1 : 0) })), 'nước tính đòn');
    assert.equal(r.total, 4);
    assert.match(r.note, /nước tính đòn/);
}
// 8c) buildKtcFreeMoveFlags với bàn cờ giả: chỉ nước Tướng của bên tấn công, đang bị chiếu, không ăn quân là MIỄN.
{
    const cell = (type, color) => ({ type, color });
    const board = () => {
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[9][4] = cell('redKing', 'red'); b[0][3] = cell('blackKing', 'black');
        b[5][0] = cell('redRook', 'red'); b[6][1] = cell('blackRook', 'black');
        return b;
    };
    const uciSq = s => ({ col: s.charCodeAt(0) - 97, row: 9 - Number(s[1]) });
    const deps = {
        cloneBoard: b => b.map(r => r.map(c => (c ? { ...c } : null))),
        parseUciMove: (u, b) => { const from = uciSq(u.slice(0, 2)), to = uciSq(u.slice(2, 4)); return { from, to, piece: b[from.row][from.col] }; },
        makeMoveInPlace: (b, m) => { const cap = b[m.to.row][m.to.col]; b[m.to.row][m.to.col] = b[m.from.row][m.from.col]; b[m.from.row][m.from.col] = null; return cap; },
        baseType: t => (/king/i.test(t) ? 'king' : 'other'),
        // "đang bị chiếu" chỉ được hỏi cho nước của Tướng bên tấn công không ăn quân (hai lần: nước 0 và nước 2);
        // các nước khác bị loại trước đó nên không gọi tới. Câu trả lời do bài test quy định theo thứ tự gọi.
        isInCheck: (() => { let i = 0; const answers = [true, false]; return () => answers[i++]; })()
    };
    // red attacker: Tướng e0->e1 khi bị chiếu (MIỄN) | đen đi Xe | Tướng e1->e2 khi KHÔNG bị chiếu (tính) |
    // Xe a5->a6 khi bị chiếu nhưng không phải Tướng (tính)
    const flags = JSON.parse(JSON.stringify(
        ctx.buildKtcFreeMoveFlags(board(), 'red', ['e0e1', 'b3b4', 'e1e2', 'b4b5', 'a5a6'], 'red', deps)));
    assert.deepEqual(flags, [true, false, false, false, false]);
}
// 8d) Quỹ thời gian xác minh là một số dương có trần hợp lý (chế độ Phối hợp cộng nó vào hạn của Pikafish).
assert.ok(ctx.mateVerifyMaxMs() >= 5000 && ctx.mateVerifyMaxMs() <= 120000);

// 8e) Tương thích về sau: MỌI ô checkbox trong hàng luật (ktc / lão nhị / võ tân ...) phải được khai báo trong
//     mateVerifyRuleAdapters. Thêm ô luật mới mà quên khai báo thì test này lỗi, nhắc người sửa khai báo
//     cách luật đó ảnh hưởng tới cách đếm nước của biến (countsMoves).
{
    const adaptersSrc = functions.get('mateVerifyRuleAdapters');
    const declared = [...adaptersSrc.matchAll(/toggleId:\s*'([^']+)'/g)].map(m => m[1]);
    assert.ok(declared.length >= 3);
    const anchor = html.indexOf('id="ktcAdvancedToggle"');
    assert.ok(anchor > 0, 'không thấy ô ktc trong HTML');
    const rowStart = html.lastIndexOf('<div', html.lastIndexOf('<label', anchor));
    const rowEnd = html.indexOf('</div>', anchor);
    const ids = [...html.slice(rowStart, rowEnd).matchAll(/<input type="checkbox" id="([^"]+)"/g)].map(m => m[1]);
    assert.ok(ids.length >= 3, 'hàng luật phải có ít nhất ktc, lão nhị, võ tân');
    for (const id of ids) {
        assert.ok(declared.includes(id),
            `ô luật "${id}" chưa có adapter trong mateVerifyRuleAdapters — khai báo nó (countsMoves true/false)`);
    }
    for (const id of declared) assert.ok(ids.includes(id), `adapter "${id}" không còn ô tương ứng trong hàng luật`);
}

// 9) Nối dây: bestmove của Pikafish đi qua bước xác minh; không xác minh khi Dừng Ngay; KHÔNG có công tắc tắt.
assert.doesNotMatch(html, /mateVerifyToggle|mateVerifyOn\(/, 'bộ hiệu chỉnh luôn chạy: không có công tắc bật/tắt');
{
    const composite = functions.get('startAnalysisComposite');
    assert.match(composite, /getAnalysisTimeLimitMs\(pika\) \+ mateVerifyMaxMs\(\)/,
        'hạn của Pikafish ở chế độ Phối hợp phải cộng quỹ thời gian xác minh (tránh "quá hạn phân tích")');
    assert.match(functions.get('probePikafishAnalysis'), /\{ board: boardIn, firstPlayer, shouldAbort: shouldSkipVerify \}/,
        'probe Phối hợp phải truyền bàn gốc và bên đi trước cho bộ xác minh');
    assert.match(functions.get('verifyPikafishMatePv'), /buildKtcFreeMoveFlags/, 'ktc phải đếm nước qua biến');
}
assert.match(html, /verifyAndFinishPikafishAnalysis\(ws, latestInfo, params, resultEl, line, positionPlan\)/,
    'bestmove phải đi qua verifyAndFinishPikafishAnalysis');
// Chế độ Phối hợp: probe Pikafish cũng xác minh biến trước khi trả kết quả, và đưa ghi chú ra thông điệp cuối.
const probeSrc = functions.get('probePikafishAnalysis');
assert.match(probeSrc, /verifyPikafishMatePv\(ws, rawInfo, \{ board: boardIn, firstPlayer, shouldAbort: shouldSkipVerify \}, plan,/, 'probe Pikafish (Phối hợp) phải xác minh biến mate');
assert.match(probeSrc, /shouldVerifyPikafishMate\(rawInfo,/);
assert.match(functions.get('buildCompositeAnalysisMessage'), /verifyNote:/, 'thông điệp Phối hợp phải mang verifyNote');
assert.match(functions.get('pikafishFreshNodeMatedIn'), /addEventListener\('close', onClose\)/, 'tìm lại một thế phải xử lý socket đóng');
const shouldVerify = functions.get('shouldVerifyPikafishMate');
assert.ok(shouldVerify, 'thiếu shouldVerifyPikafishMate');
assert.match(shouldVerify, /!params\.earlyStopped/);
// Không còn loại trừ theo chế độ/luật: ktc và các luật khác do adapter lo, không bị bỏ qua ở cổng này.
assert.doesNotMatch(shouldVerify, /ktcBudgetOn|ktcFlip/);
{
    const c2 = vm.createContext({});
    vm.runInContext(shouldVerify, c2);
    const mate = { scoreType: 'mate', scoreVal: 7, pv: ['a', 'b', 'c'] };
    assert.equal(c2.shouldVerifyPikafishMate(mate, {}), true);
    assert.equal(c2.shouldVerifyPikafishMate(mate, { earlyStopped: true }), false);
    assert.equal(c2.shouldVerifyPikafishMate({ ...mate, pv: ['a'] }, {}), false);
    assert.equal(c2.shouldVerifyPikafishMate({ scoreType: 'cp', scoreVal: 100, pv: ['a', 'b'] }, {}), false);
    assert.equal(c2.shouldVerifyPikafishMate(null, {}), false);
}

// 10) Bước hiệu chỉnh hiện thành TRẠNG THÁI RIÊNG (không chạy chồng lên "đang dò"): chế độ Phối hợp đổi dòng
//     "⏳ 19s/15s ..." thành "🔁 Đang hiệu chỉnh ... thế k/n"; đường Pikafish riêng có dòng riêng theo analysisMateVerify.
{
    assert.ok(functions.has('compositeProbeStateText'), 'thiếu compositeProbeStateText');
    const c3 = vm.createContext({ Math, Number });
    vm.runInContext('const PIKAFISH_MAX_SEARCH_DEPTH = 245; function fmtElapsed(ms) { return ms + "ms"; }' +
        'function bruteForceDepthText(d) { return "mốc " + d; }', c3);
    vm.runInContext(functions.get('compositeProbeStateText'), c3);
    const base = { limitMs: 15000, state: 'running', liveInfo: { scoreType: 'mate', scoreVal: 14, depth: 97 } };
    const searching = c3.compositeProbeStateText({ ...base }, 19, 'x', false);
    assert.match(searching, /^⏳ 19s\/15s/, 'đang dò vẫn hiện đồng hồ giây');
    const verifying = c3.compositeProbeStateText({ ...base, verify: { current: 3, total: 13 } }, 19, 'x', false);
    assert.equal(verifying, '🔁 Đang hiệu chỉnh 3/13 · mate 14', 'dòng hiệu chỉnh phải ngắn gọn');
    assert.doesNotMatch(verifying, /19s\/15s/, 'khi hiệu chỉnh không được hiện "19s/15s" như đang dò');
    assert.ok(verifying.length <= 40, 'dòng hiệu chỉnh không được dài (không tràn dòng trong khung kết quả)');
    // Đường Pikafish riêng: dòng riêng + biến trạng thái được đặt/xoá quanh bước hiệu chỉnh.
    assert.match(html, /Đang hiệu chỉnh<\/strong> \$\{analysisMateVerify\.current\}\/\$\{analysisMateVerify\.total\}/, 'phải có dòng hiệu chỉnh riêng');
    const vf = functions.get('verifyAndFinishPikafishAnalysis');
    assert.match(vf, /analysisMateVerify = p/);
    assert.match(vf, /finally \{\s*analysisMateVerify = null;/);
    assert.doesNotMatch(vf, /stopAnalysisTimersOnly\(\);\s*\n\s*try/, 'đồng hồ phải chạy tiếp trong lúc hiệu chỉnh');
    // Phối hợp: probe báo tiến độ và dọn trạng thái khi xong/lỗi.
    const probe = functions.get('probePikafishAnalysis');
    assert.match(probe, /onVerifyProgress = null/);
    assert.match(probe, /endVerify\(\); finish\(/);
}

// 11) Chế độ Phối hợp: Brute-force đã có mate thì Pikafish KHỎI hiệu chỉnh (số của Brute-force được dùng), cả khi chưa
//     bắt đầu lẫn khi đang chạy dở.
(async () => {
    const composite = functions.get('startAnalysisComposite');
    assert.match(composite, /bruteForceHasMate/, 'Phối hợp phải biết khi nào Brute-force đã có mate');
    assert.match(composite, /!!params\.earlyStopped \|\| bruteForceHasMate\(\)/, 'cờ bỏ hiệu chỉnh gồm Brute-force có mate');
    assert.match(functions.get('probePikafishAnalysis'), /shouldAbort: shouldSkipVerify/, 'probe phải cho phép hủy giữa chừng');

    // Hành vi thật của vòng xác minh với một "tìm lại" giả: đếm số lần hỏi engine.
    const c4 = vm.createContext({ console, Date, Math, Number, Array, Promise, Error, document: { getElementById: () => null } });
    vm.runInContext('let analysisCancelled = false, ktcBudgetOn = false, ktcExemptColor = null,' +
        ' checkStreakBonusRuleOn = false, checkStreakFreeCaptureRuleOn = false;' +
        'let calls = 0; async function pikafishFreshNodeMatedIn(ws, cmd, prefix, remaining) { calls++; return { matedIn: remaining, pv: ["z"] }; }' +
        'function otherSide(s) { return s === "red" ? "black" : "red"; }', c4);
    for (const n of ['planMatePvVerification', 'reconcileMatePvClaim', 'buildCorrectedMatePv', 'mateVerifyMaxMs',
        'mateVerifyRuleAdapters', 'unknownActiveMateVerifyRules', 'buildKtcFreeMoveFlags', 'verifyPikafishMatePv']) {
        vm.runInContext(functions.get(n), c4);
    }
    const info = { scoreType: 'mate', scoreVal: 6, pv: pvOf(11) };
    const run = async (params) => {
        vm.runInContext('calls = 0', c4);
        c4.__info = info; c4.__params = params;
        const out = await vm.runInContext(
            'verifyPikafishMatePv(null, __info, __params, { positionCommand: "position fen x" }, { innerHTML: "" })', c4);
        return { out, calls: vm.runInContext('calls', c4) };
    };
    // Bình thường: hỏi engine cho cả 5 thế dọc biến.
    const normal = await run({});
    assert.equal(normal.calls, 5);
    assert.ok(normal.out && normal.out.rec.checked === 5);
    // Brute-force đã có mate từ đầu: không hỏi engine lần nào, không có kết quả hiệu chỉnh.
    const early = await run({ shouldAbort: () => true });
    assert.equal(early.calls, 0);
    assert.equal(early.out, null);
    // Brute-force có mate GIỮA CHỪNG (sau 2 thế): dừng ngay, không hỏi tiếp.
    vm.runInContext('calls = 0', c4);
    c4.__abortAfter = 2;
    const mid = await vm.runInContext(
        'verifyPikafishMatePv(null, __info, { shouldAbort: () => calls >= __abortAfter }, { positionCommand: "p" }, { innerHTML: "" })', c4);
    assert.equal(mid, null);
    assert.equal(vm.runInContext('calls', c4), 2);

    // Không lệch thì KHÔNG có preVerifyScoreVal; lệch (bị nâng) thì có số cũ.
    assert.equal('preVerifyScoreVal' in normal.out.info, false, 'không lệch thì không thêm số trước hiệu chỉnh');
    vm.runInContext('async function pikafishFreshNodeMatedIn(ws, cmd, prefix, remaining) { calls++; return { matedIn: remaining + 1, pv: ["z"] }; }', c4);
    const raised = await run({});
    assert.ok(raised.out.rec.delta > 0);
    assert.equal(raised.out.info.preVerifyScoreVal, 6, 'bị nâng thì giữ số cũ');
    assert.ok(raised.out.info.scoreVal > 6);

    // Dòng "Từng engine": dùng đúng dòng Pikafish, thêm "(trước hiệu chỉnh: N)" CHỈ khi lệch, không thêm dòng mới.
    const c5 = vm.createContext({ Math, Number, String, Array, Object });
    vm.runInContext('const BRAIN_LABELS = { pikafish: "Pikafish", bruteforce: "Brute-force" };' +
        'const PIKAFISH_MAX_SEARCH_DEPTH = 245;', c5);
    vm.runInContext(functions.get('buildCompositeEngineReportHtml'), c5);
    const render = (pikaInfo) => c5.buildCompositeEngineReportHtml([
        { engine: 'pikafish', info: pikaInfo, moveStr: 'x' },
        { engine: 'bruteforce', info: { scoreType: 'mate', scoreVal: 6, depth: 3 }, moveStr: 'y' }], 'bruteforce');
    const lech = render({ scoreType: 'mate', scoreVal: 6, preVerifyScoreVal: 5, depth: 40 });
    assert.match(lech, /mate 6 \(trước hiệu chỉnh: 5\)/);
    const khongLech = render({ scoreType: 'mate', scoreVal: 6, depth: 40 });
    assert.doesNotMatch(khongLech, /trước hiệu chỉnh/);
    const count = (s) => (s.match(/<li>/g) || []).length;
    assert.equal(count(lech), count(khongLech), 'không được thêm dòng mới');
})().then(
    () => console.log('PASS xác minh biến mate Pikafish: lập thế, đối chiếu (ca 14 -> 15), dựng lại biến, bỏ khi Brute-force có mate, nối dây'),
    e => { console.error(e); process.exitCode = 1; });
