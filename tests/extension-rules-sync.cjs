// Đối chiếu luật nhận dạng dùng chung (rules.js) giữa extension chính và bản Android Lite.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const mainDir = path.join(root, 'tiktok_auto_reply_extension');
const liteDir = path.join(root, 'dist', 'android', 'tiktok_auto_reply_android_extension');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const R = require(path.join(mainDir, 'rules.js'));
const cfg = Object.assign({ limit1: 5 }, R.DEFAULTS);
const run = t => R.analyze(t, cfg);

// 1) Luật: tiền tố, số, hậu tố và cụm loại ktc (kể cả ghép chữ cái đầu).
const cases = [
    ['đỏ 3n 2l', true],
    ['xanh thủ 6n 2l', true],
    ['đỏ 3n 2l ktc', false],
    ['đỏ 3n 2l không tính chiếu', false],
    ['đỏ 3n 2m tui không tính chiếu', false],
    ['đỏ 3n 2l hay quá nha', true],
    ['đỏ 9n 2l', false],
    ['xanh 3n 2l', false],
    ['đỏ 3n 2x', false],
    ['abc 3n 2l', false],
];
for (const [text, green] of cases) assert.equal(run(text).green, green, `"${text}" phải ${green ? 'khớp' : 'bị loại'}`);
assert.equal(R.analyze('đỏ 3n 2l', Object.assign({}, cfg, { limit1: 0 })).green, false, 'chưa có Nước thì không khớp');

// 2) Hai bản phải dùng CÙNG rules.js, không tự viết lại luật.
const liteRules = path.join(liteDir, 'rules.js');
if (fs.existsSync(liteDir)) {
    assert.ok(fs.existsSync(liteRules), 'bản Lite thiếu rules.js — chạy build-xiangqi.bat để đồng bộ');
    assert.equal(read(liteRules), read(mainDir, 'rules.js'), 'rules.js của Lite lệch bản gốc — chạy build-xiangqi.bat để đồng bộ');
    const m = JSON.parse(read(liteDir, 'manifest.json')).content_scripts[0].js;
    assert.ok(m.indexOf('rules.js') >= 0 && m.indexOf('rules.js') < m.indexOf('content.js'), 'Lite: rules.js phải nạp trước content.js');
    assert.match(read(liteDir, 'popup.html'), /rules\.js[\s\S]*popup\.js/, 'Lite: popup.html phải nạp rules.js trước popup.js');
    for (const f of ['content.js', 'popup.js']) {
        const src = read(liteDir, f);
        assert.ok(!/function\s+(normalize|detectGroup|hasBanPhrase)\b/.test(src), `Lite ${f} không được tự định nghĩa lại luật`);
    }
}
const mm = JSON.parse(read(mainDir, 'manifest.json')).content_scripts[0].js;
assert.ok(mm.indexOf('rules.js') >= 0 && mm.indexOf('rules.js') < mm.indexOf('content.js'), 'Chính: rules.js phải nạp trước content.js');
assert.match(read(mainDir, 'popup.html'), /rules\.js[\s\S]*popup\.js/, 'Chính: popup.html phải nạp rules.js trước popup.js');
for (const f of ['content.js', 'popup.js']) {
    assert.ok(!/function\s+(normalize|detectGroup|hasBanPhrase)\b/.test(read(mainDir, f)), `Chính ${f} không được tự định nghĩa lại luật`);
}
console.log('extension-rules-sync: OK');
