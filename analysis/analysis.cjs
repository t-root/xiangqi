#!/usr/bin/env node
// Phân tích thế cờ bằng engine Brute-force, có LƯU và TIẾP TỤC tiến độ — một tệp duy nhất.
//
//   node analysis.cjs                         mở menu điều khiển bằng phím (cách dùng chính: bấm đúp analysis.bat)
//   node analysis.cjs --fen "<FEN>" [...]     phân tích một thế bằng dòng lệnh (menu cũng gọi chế độ này bên trong)
//   node analysis.cjs --list | --help
//
// Biến môi trường (dùng cho kiểm thử/điều khiển từ ngoài): PHANTICH_KEYS, PHANTICH_PIPE, PHANTICH_DATA, BFANALYZE_EXE.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// Chạy dạng exe đơn (Node SEA, dựng bằng build-exe.ps1): dữ liệu nằm cạnh exe, engine được bung ra bin/ từ tài nguyên nhúng.
let sea = null;
try { const m = require('node:sea'); if (m.isSea()) sea = m; } catch (_) { /* Node cũ không có node:sea */ }
const APP_DIR = sea ? path.dirname(process.execPath) : __dirname;
if (sea) {
  const name = process.platform === 'win32' ? 'bfanalysis.exe' : 'bfanalysis';
  const dest = path.join(APP_DIR, 'bin', name);
  try {
    const asset = Buffer.from(sea.getRawAsset(name));
    let same = false;
    try { same = fs.statSync(dest).size === asset.length; } catch (_) { /* chưa có */ }
    if (!same) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.tmp';
      fs.writeFileSync(tmp, asset, { mode: 0o755 });
      fs.renameSync(tmp, dest);
    }
  } catch (e) { console.error('Không bung được engine: ' + e.message); process.exit(1); }
  // Bản chạy bằng analysis.bat tự đặt UTF-8 cho cửa sổ lệnh; exe phải tự làm.
  if (process.platform === 'win32' && process.argv.length <= 2) {
    try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch (_) { /* bỏ qua */ }
  }
}

// ===================== 0. SQLite: data/analysis.db =====================
// Lưu ở dạng truy vấn được: vị trí (kết quả, tuyến), lịch sử lưu và SÁCH ĐÁP ÁN (nước thắng cho từng thế trên cây chứng minh).
// Bảng chuyển vị ~300 MB vẫn ở tệp .bfck (chỉ cần nạp lại để dò tiếp). Cần Node >= 22.5 (node:sqlite); thiếu thì bỏ qua.
let dbSync = null;   // gán sau khi store sẵn sàng
const sqlite = (() => {
  let DatabaseSync;
  try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch (_) { return null; }
  const cache = new Map();
  function open(dir) {
    const file = path.join(dir, 'analysis.db');
    if (cache.has(file)) return cache.get(file);
    fs.mkdirSync(dir, { recursive: true });
    const d = new DatabaseSync(file);
    d.exec(`
      PRAGMA busy_timeout = 30000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY,
        file TEXT UNIQUE NOT NULL,
        fen TEXT NOT NULL, side TEXT, restricted INTEGER, rule_limit INTEGER, bonus INTEGER, ktc INTEGER,
        requested INTEGER, completed INTEGER, active INTEGER,
        mate_found INTEGER, mate_k INTEGER, pv TEXT,
        accumulated_ms INTEGER, slices INTEGER, bytes INTEGER, updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS history (
        position_id INTEGER NOT NULL, ts TEXT NOT NULL, completed INTEGER, active INTEGER, mate INTEGER,
        accumulated_ms INTEGER, nodes INTEGER, bytes INTEGER, save_ms INTEGER, threads INTEGER,
        tt_bits INTEGER, tt_used0 INTEGER, slices INTEGER,
        UNIQUE (position_id, ts, accumulated_ms)
      );
    `);
    // Bảng sách: v2 thêm cột kind ('A' = thế bên tấn công đến lượt, 'D' = thế bên thủ đến lượt kèm nước cầm cự lâu nhất).
    // Bản v1 (chỉ có thế bên tấn công) bỏ đi và dựng lại khi xây sách.
    const hasKind = d.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('book') WHERE name = 'kind'").get().n > 0;
    const hasBook = d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'book'").get().n > 0;
    if (hasBook && !hasKind) d.exec('DROP TABLE book');
    d.exec(`
      CREATE TABLE IF NOT EXISTS book (
        position_id INTEGER NOT NULL, fen TEXT NOT NULL, cs_red INTEGER NOT NULL, cs_black INTEGER NOT NULL,
        kind TEXT NOT NULL, move TEXT NOT NULL, mate_in INTEGER NOT NULL, budget_red INTEGER, budget_black INTEGER,
        PRIMARY KEY (position_id, fen, cs_red, cs_black)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS book_fen ON book (fen);
    `);
    const q = {
      upsert: d.prepare(`INSERT INTO positions (file, fen, side, restricted, rule_limit, bonus, ktc, requested, completed, active, mate_found, mate_k, pv, accumulated_ms, slices, bytes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (file) DO UPDATE SET fen = excluded.fen, side = excluded.side, restricted = excluded.restricted, rule_limit = excluded.rule_limit,
          bonus = excluded.bonus, ktc = excluded.ktc, requested = excluded.requested, completed = excluded.completed, active = excluded.active,
          mate_found = excluded.mate_found, mate_k = excluded.mate_k, pv = COALESCE(excluded.pv, positions.pv), accumulated_ms = excluded.accumulated_ms,
          slices = excluded.slices, bytes = excluded.bytes, updated_at = excluded.updated_at
        RETURNING id`),
      hist: d.prepare(`INSERT OR IGNORE INTO history (position_id, ts, completed, active, mate, accumulated_ms, nodes, bytes, save_ms, threads, tt_bits, tt_used0, slices)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      bookIns: d.prepare(`INSERT OR REPLACE INTO book (position_id, fen, cs_red, cs_black, kind, move, mate_in, budget_red, budget_black) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      bookCount: d.prepare('SELECT COUNT(*) AS n FROM book WHERE position_id = ?'),
      bookClear: d.prepare('DELETE FROM book WHERE position_id = ?'),
      idByFile: d.prepare('SELECT id FROM positions WHERE file = ?'),
      lookup: d.prepare(`SELECT kind, move, mate_in, cs_red, cs_black FROM book WHERE fen = ?
        ORDER BY (cs_red = 0 AND cs_black = 0) DESC, mate_in ASC LIMIT 1`),
    };
    const tx = (fn) => { d.exec('BEGIN'); try { const out = fn(); d.exec('COMMIT'); return out; } catch (e) { d.exec('ROLLBACK'); throw e; } };
    const handle = {
      file,
      upsert(item) {
        return q.upsert.get(item.file, item.fen, item.side, item.restricted, item.limit, item.bonus ? 1 : 0, item.ktc ? 1 : 0, item.requested, item.completed,
          item.active, item.mate ? 1 : 0, item.mateK, item.pv || null, item.accumulatedMs, item.slices, item.bytes, new Date().toISOString()).id;
      },
      addHistory(id, rows) {
        tx(() => { for (const x of rows) q.hist.run(id, x.time, x.completed, x.active, x.mate ? 1 : 0, x.accumulatedMs, x.nodes, x.bytes, x.saveMs, x.threads, x.ttBits, x.ttUsed0, x.slices); });
      },
      idByFile(f) { const row = q.idByFile.get(f); return row ? row.id : null; },
      bookCount(id) { return id == null ? 0 : q.bookCount.get(id).n; },
      bookClear(id) { q.bookClear.run(id); },
      bookInsert(id, rows) {
        tx(() => { for (const x of rows) q.bookIns.run(id, x.fen, x.csRed, x.csBlack, x.kind, x.move, x.mateIn, x.budgetRed, x.budgetBlack); });
      },
      lookup(fen) { return q.lookup.get(fen) || null; },
      checkpoint() { d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); },
      close() { d.close(); cache.delete(file); },
    };
    cache.set(file, handle);
    return handle;
  }
  return { open };
})();

// ===================== 1. Đọc danh sách tiến độ đã lưu =====================
// Đọc một dòng "info string checkpoint item ... key=value ... file=<tên tệp có thể có dấu cách>" (file= luôn ở cuối).
function parseKv(line) {
  const i = line.lastIndexOf(' file=');
  const head = i >= 0 ? line.slice(0, i) : line;
  const o = Object.fromEntries([...head.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
  if (i >= 0) o.file = line.slice(i + 6).trim();
  return o;
}


const store = (() => {

const ROOT = APP_DIR;
const EXE_BASE = path.join(ROOT, 'bin', process.platform === 'win32' ? 'bfanalysis.exe' : 'bfanalysis');
// Nếu có bản engine mới dựng dở (bfanalysis.new.exe, do bản cũ đang chạy nên chưa thay được) và nó mới hơn thì dùng nó.
const EXE_NEW = EXE_BASE.replace(/(\.exe)?$/, '.new$1');
const EXE = process.env.BFANALYZE_EXE || ((() => { try { return fs.statSync(EXE_NEW).mtimeMs > fs.statSync(EXE_BASE).mtimeMs; } catch (_) { return false; } })() ? EXE_NEW : EXE_BASE);

// Nhóm hiển thị: mate = đã có mate; partial = chưa có mate, còn dở; complete = đã quét trọn tới budget, không có thắng ép.
const GROUPS = {
  mate: 'Đã có mate',
  partial: 'Chưa có mate (đang dở)',
  complete: 'Đã quét trọn, không có mate',
};

function groupOf(item) {
  if (item.mate) return 'mate';
  if (item.requested > 0 && item.completed >= item.requested) return 'complete';
  return 'partial';
}

function parseItem(line, dir) {
  const f = parseKv(line);
  if (!f.file || f.status || !f.fen) return null;
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(path.join(dir, f.file)).mtimeMs; } catch (_) { /* tệp vừa bị xoá */ }
  const item = {
    file: f.file,
    fen: f.fen.replace(/_/g, ' '),
    side: f.side === 'b' ? 'b' : 'w',
    restricted: +f.restricted || 0,
    limit: +f.limit || 2,
    bonus: f.bonus === '1',
    ktc: f.ktc === '1',
    roots: f.roots === '1',
    requested: +f.requested || 0,
    completed: +f.completed || 0,
    active: +f.active || 0,
    mate: f.mate === '1',
    mateK: +f.mateK || 0,
    accumulatedMs: +f.accumulatedMs || 0,
    slices: +f.slices || 0,
    bytes: +f.bytes || 0,
    mtimeMs,
    pv: f.pv ? f.pv.split(',').join(' ') : '',
  };
  item.group = groupOf(item);
  return item;
}

/** Trả về mọi tiến độ (mới nhất trước). */
function listCheckpoints(dir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(EXE)) return reject(new Error('chưa có engine: ' + EXE + ' (chạy build.ps1)'));
    if (!fs.existsSync(dir)) return resolve([]);
    const child = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', () => {
      const items = out.split(/\r?\n/).filter((l) => l.startsWith('info string checkpoint item'))
        .map((l) => parseItem(l, dir)).filter(Boolean);
      items.sort((a, b) => b.mtimeMs - a.mtimeMs);
      try { if (dbSync) dbSync(dir, items); } catch (_) { /* DB chỉ là bản sao truy vấn; lỗi không được làm hỏng việc liệt kê */ }
      resolve(items);
    });
    child.stdin.write(`bruteforce\nsetoption name DataDir value ${dir}\ncheckpoint list\nquit\n`);
    setTimeout(() => { try { child.kill(); } catch (_) { /* đã thoát */ } }, 20000);
  });
}

const RULE_NAME = { 0: 'none', 1: 'red', 2: 'black', 3: 'both' };
function ruleLabel(item) {
  const analysis = (item.side === 'w' && item.restricted === 2) || (item.side === 'b' && item.restricted === 1);
  if (analysis) return `Phân Tích (bên đi sau chiếu tối đa ${item.limit} lần)`;
  const base = { 0: 'tắt luật', 1: 'chỉ Đỏ bị giới hạn', 2: 'chỉ Đen bị giới hạn', 3: 'cả hai bên bị giới hạn' }[item.restricted];
  return item.restricted ? `${base} (${item.limit} lần)` : base;
}

/** Tham số dòng lệnh analysis.cjs để làm việc với đúng bài toán của tiến độ này (cùng luật => cùng tệp). */
function argsFor(item, dir, extra = []) {
  const args = ['--fen', item.fen, '--data', dir, '--rule', RULE_NAME[item.restricted] || 'none', '--limit', String(item.limit),
    '--budget', String(Math.max(1, item.requested || 15))];
  if (item.bonus) args.push('--bonus');
  if (item.ktc) args.push('--ktc');
  return [...args, ...extra];
}

const fmtMs = (ms) => {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + ' giây';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' phút ' + Math.round(s - m * 60) + ' giây';
  return Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút';
};
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => {
  if (!ms) return '--';
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function resultText(item) {
  if (item.mate) return `mate ${Math.abs(item.mateK)}`;
  if (item.group === 'complete') return `không mate ≤ ${item.requested}`;
  return `quét xong mức ${item.completed}` + (item.requested ? `/${item.requested}` : '');
}

/** Lịch sử lưu của một tiến độ: mỗi lần lưu một dòng trong <mã>.log (mới nhất ở cuối). */
function readHistory(dir, file) {
  const logPath = path.join(dir, file.replace(/\.bfck$/, '.log'));
  let text = '';
  try { text = fs.readFileSync(logPath, 'utf8'); } catch (_) { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = Object.fromEntries([...line.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    rows.push({ time: line.split(' ')[0], completed: +f.completed, active: +f.active, mate: f.mate === '1', accumulatedMs: +f.accumulatedMs,
      nodes: +f.nodes, bytes: +f.bytes, saveMs: +f.saveMs, threads: +f.threads, ttBits: +f.ttBits, ttUsed0: +f.ttUsed0, slices: +f.slices });
  }
  for (let i = 0; i < rows.length; i++) {   // tốc độ giữa hai lần lưu liên tiếp
    const prev = rows[i - 1];
    rows[i].nps = prev && rows[i].accumulatedMs > prev.accumulatedMs ? (rows[i].nodes - prev.nodes) / ((rows[i].accumulatedMs - prev.accumulatedMs) / 1000) : null;
    rows[i].fill = rows[i].ttBits ? rows[i].ttUsed0 / 2 ** rows[i].ttBits : null;
  }
  return rows;
}

return { readHistory, EXE, GROUPS, listCheckpoints, argsFor, ruleLabel, fmtMs, fmtTime, resultText, groupOf, parseItem };

})();

// Đồng bộ danh sách tiến độ (nguồn thật là các tệp .bfck) vào SQLite, kèm lịch sử lưu từ tệp .log.
dbSync = (dir, items) => {
  const database = sqlite && sqlite.open(dir);
  if (!database) return;
  for (const item of items) {
    const id = database.upsert(item);
    const rows = store.readHistory(dir, item.file);
    if (rows.length) database.addHistory(id, rows);
  }
};

// Đếm số thế trong sách đáp án của một tiến độ (null nếu không có SQLite).
function bookCountOf(dir, item) {
  const database = sqlite && sqlite.open(dir);
  if (!database) return null;
  return database.bookCount(database.idByFile(item.file));
}

// Áp một nước kiểu UCI ("h2e2") lên FEN, giữ nguyên bên đi và phần đuôi; trả { fen, piece } hoặc null.
function applyUci(fen, uci) {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci || '')) return null;
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/').map((rowText) => { const a = []; for (const ch of rowText) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) a.push(''); else a.push(ch); } return a; });
  const fc = uci.charCodeAt(0) - 97, fr = 9 - parseInt(uci[1], 10), tc = uci.charCodeAt(2) - 97, tr = 9 - parseInt(uci[3], 10);
  if (!rows[fr] || !rows[fr][fc]) return null;
  const piece = rows[fr][fc];
  rows[tr][tc] = piece;
  rows[fr][fc] = '';
  const board = rows.map((row) => { let t = ''; let n = 0; for (const c of row) { if (!c) n++; else { if (n) { t += n; n = 0; } t += c; } } if (n) t += n; return t; }).join('/');
  return { fen: [board, ...parts.slice(1)].join(' '), piece };
}

// ===================== 2. Phân tích dòng lệnh =====================
const cli = (() => {

const HERE = APP_DIR;
const EXE = store.EXE;

const HELP = `Dùng:  node analysis.cjs --fen "<FEN>" [tuỳ chọn]

  --fen <FEN>        thế cờ (bắt buộc trừ khi dùng --list)
  --budget <N>       số nước tối đa mỗi bên (1..60, mặc định 15)
  --time <giây>      giới hạn thời gian của LẦN CHẠY này (0 = không giới hạn, mặc định 0)
  --threads <N|auto> số luồng (mặc định auto = một nửa số luồng của máy)
  --rule <luật>      analysis (mặc định: bên đi sau chỉ được chiếu liên tiếp --limit lần) | both | red | black | none
  --limit <N>        số lần chiếu liên tiếp tối đa của một quân (mặc định 2)
  --bonus            bật luật "cản rồi bị ăn mà vẫn chiếu" (+1)
  --ktc              đếm theo luật ktc (chạy Tướng khi bị chiếu không tính nước)
  --data <thư mục>   nơi lưu tiến độ (mặc định analysis/data)
  --autosave <giây>  tự lưu tiến độ mỗi chu kỳ này (mặc định 600 = 10 phút, 0 = chỉ lưu khi xong mức/dừng; chu kỳ tự giãn ra nếu tệp lớn)
  --hash-bits <N>    cỡ bảng băm mỗi luồng 2^N ô x 16 byte (16..26, mặc định 22 = 64 MB)
  --witness-limit <N> số "witness" tối đa mỗi luồng để dựng lại tuyến đầy đủ (mặc định 500000, tốn ~70 byte/ô)
  --book             xây SÁCH ĐÁP ÁN cho thế đã có mate (nước thắng của mọi thế trên cây chứng minh) và lưu vào data/analysis.db
  --book-max <N>     số thế tối đa của sách (mặc định không giới hạn)
  --book-dev <N>     số vòng lưu tiếp sau một nước đi sai của bên công (mặc định 1; mỗi vòng thêm ~35 lần dung lượng/thời gian)
  --book-depth <N>   số nước công được lưu (mặc định 0 = một nửa số nước mate, nửa sau để engine giải; -1 = lưu đầy đủ). Bị dừng giữa chừng thì lần sau tự làm tiếp; thêm --new để xây lại từ đầu
  --guide            tra nước thắng kế tiếp trong sách cho --fen (không cần engine)
  --allow-sleep      cho phép máy tự ngủ khi đang phân tích (mặc định: giữ máy không ngủ, màn hình vẫn tắt được)
  --new              bỏ tiến độ đã lưu của thế này rồi phân tích lại từ đầu
  --clear            chỉ xoá tiến độ của thế này rồi thoát
  --list             liệt kê mọi tiến độ đã lưu rồi thoát
  --json             in kết quả cuối dạng JSON (một dòng) thay cho dạng đọc
  --quiet            chỉ in kết quả cuối

Mã thoát: 0 = tìm thấy chiếu bí, 2 = đã quét xong tới --budget mà không có thắng ép, 3 = dừng giữa chừng (còn tiếp tục được), 1 = lỗi.`;

function parseArgs(argv) {
  const o = { budget: 15, time: 0, threads: 'auto', rule: 'analysis', limit: 2, bonus: false, ktc: false, allowSleep: false, book: false, bookMax: 0, bookDepth: 0, bookDev: 1, guide: false,
    data: path.join(HERE, 'data'), autosave: 600, hashBits: 22, witnessLimit: 500000, fresh: false, clear: false, list: false, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error('thiếu giá trị sau ' + a); return argv[++i]; };
    switch (a) {
      case '--fen': o.fen = next(); break;
      case '--budget': o.budget = parseInt(next(), 10); break;
      case '--time': o.time = parseFloat(next()); break;
      case '--threads': o.threads = next(); break;
      case '--rule': o.rule = next(); break;
      case '--limit': o.limit = parseInt(next(), 10); break;
      case '--bonus': o.bonus = true; break;
      case '--ktc': o.ktc = true; break;
      case '--allow-sleep': o.allowSleep = true; break;
      case '--book': o.book = true; break;
      case '--book-max': o.bookMax = parseInt(next(), 10); break;
      case '--book-depth': o.bookDepth = parseInt(next(), 10); break;
      case '--book-dev': o.bookDev = parseInt(next(), 10); break;
      case '--guide': o.guide = true; break;
      case '--data': o.data = path.resolve(next()); break;
      case '--autosave': o.autosave = parseInt(next(), 10); break;
      case '--hash-bits': o.hashBits = parseInt(next(), 10); break;
      case '--witness-limit': o.witnessLimit = parseInt(next(), 10); break;
      case '--new': o.fresh = true; break;
      case '--clear': o.clear = true; break;
      case '--list': o.list = true; break;
      case '--json': o.json = true; break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error('tuỳ chọn lạ: ' + a);
    }
  }
  return o;
}

function ruleOptions(o) {
  const side = (o.fen || '').trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
  let restricted;
  switch (o.rule) {
    case 'analysis': restricted = side === 'w' ? 'black' : 'white'; break;   // bên đi sau
    case 'both': restricted = 'both'; break;
    case 'red': restricted = 'white'; break;
    case 'black': restricted = 'black'; break;
    case 'none': restricted = 'none'; break;
    default: throw new Error('--rule phải là analysis|both|red|black|none');
  }
  return [['CheckStreak_RestrictedColor', restricted], ['CheckStreak_Limit', o.limit],
    ['CheckStreak_BonusRule', o.bonus ? 'true' : 'false'], ['KtcBudget', o.ktc ? 'true' : 'false']];
}

function validate(o) {
  if (o.help) return;
  if (!o.list && !o.fen) throw new Error('thiếu --fen (hoặc dùng --list)');
  if (!(o.budget >= 1 && o.budget <= 60)) throw new Error('--budget phải từ 1 đến 60');
  if (!(o.time >= 0)) throw new Error('--time phải >= 0');
  if (!(o.limit >= 1 && o.limit <= 20)) throw new Error('--limit phải từ 1 đến 20');
  if (!(o.autosave >= 0)) throw new Error('--autosave phải >= 0');
  if (!(o.hashBits >= 16 && o.hashBits <= 26)) throw new Error('--hash-bits phải từ 16 đến 26');
  if (o.threads !== 'auto' && !(parseInt(o.threads, 10) >= 1)) throw new Error('--threads phải là số >= 1 hoặc auto');
  if (o.fen && !/^[rnbakcpRNBAKCP1-9/]+ [wb]\b/.test(o.fen.trim())) throw new Error('FEN không hợp lệ');
}

const fmt = (n) => Number(n).toLocaleString('vi-VN');
const fmtMs = (ms) => {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + ' giây';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' phút ' + Math.round(s - m * 60) + ' giây';
  return Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút';
};

function startEngine() {
  if (!fs.existsSync(EXE)) throw new Error('chưa có engine: ' + EXE + ' (chạy build.ps1)');
  return spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

// Gửi lệnh, gom các dòng trả về cho tới khi `isDone(line)` đúng. onLine nhận từng dòng.
function session(child, onLine) {
  const lines = [];
  let buf = '';
  const waiters = [];
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.startsWith('book ')) lines.push(line);
      if (onLine) onLine(line);
      for (const w of [...waiters]) if (w.test(line)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(line); }
    }
  });
  child.stderr.on('data', () => {});
  return {
    lines,
    send: (s) => child.stdin.write(s + '\n'),
    waitFor: (test) => new Promise((resolve) => {
      const found = lines.find(test);
      if (found !== undefined) resolve(found); else waiters.push({ test, resolve });
    }),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  validate(o);
  fs.mkdirSync(o.data, { recursive: true });
  if (o.guide) {
    if (!o.fen) throw new Error('--guide cần --fen');
    const database = sqlite && sqlite.open(o.data);
    if (!database) throw new Error('cần Node >= 22.5 (node:sqlite) để tra sách đáp án');
    const hit = database.lookup(o.fen.trim());
    if (!hit) { console.log('Không có thế này trong sách đáp án (chưa xây sách, hoặc thế nằm ngoài cây chứng minh / nước đi sai luật).'); return 2; }
    if (hit.kind === 'D') console.log(`Bên thủ: nước cầm cự lâu nhất là ${hit.move}  (bên thắng cần thêm ${hit.mate_in} nước sau đó)`);
    else console.log(hit.mate_in === 1 ? `Nước thắng: ${hit.move}  → CHIẾU BÍ ngay.` : `Nước thắng: ${hit.move}  (chiếu bí sau ${hit.mate_in} nước của bên thắng)`);
    return 0;
  }
  const child = startEngine();
  let exited = false;
  child.on('exit', () => { exited = true; });
  const quiet = o.quiet || o.json;
  const sess = session(child, (line) => handleLine(line));

  // ---- trạng thái in ra ----
  let lastMate = null;
  let bookSink = null;   // nhận các dòng "book ..." khi đang xây sách
  const state = { loaded: null, saved: null, outcome: null, best: null, depthDone: 0, accumulatedMs: 0 };
  // ---- tiến độ TRỰC TIẾP: một dòng tự cập nhật (nút, nút/giây, thời gian) để màn hình không bị đứng ----
  const liveProgress = !!((process.stdout.isTTY || process.env.PHANTICH_PROGRESS) && !quiet);
  const SPIN = ['|', '/', '-', '+'];
  let spinIdx = 0;
  let progressShown = false;
  const cols = () => Math.max(40, (process.stdout.columns || 100) - 1);
  const clearProgress = () => {
    if (progressShown) { process.stdout.write('\r' + ' '.repeat(cols()) + '\r'); progressShown = false; }
  };
  if (liveProgress) {   // mọi dòng in ra khác phải xoá dòng tiến độ trước để không bị dính vào nhau
    const origLog = console.log;
    console.log = (...a) => { clearProgress(); origLog(...a); };
  }
  const fmtNps = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' triệu nút/giây' : n >= 1e3 ? Math.round(n / 1e3) + ' nghìn nút/giây' : n + ' nút/giây');
  function showProgress(level, nodes, nps, elapsedMs, saving) {
    spinIdx = (spinIdx + 1) % SPIN.length;
    const text = saving
      ? `  ${SPIN[spinIdx]} mức ${level}: đang lưu tiến độ… (${fmt(nodes)} nút)`
      : `  ${SPIN[spinIdx]} mức ${level}: ${fmt(nodes)} nút · ${fmtNps(nps)} · đã dò ${fmtMs(elapsedMs)}`;
    process.stdout.write('\r' + text.slice(0, cols()).padEnd(cols()));
    progressShown = true;
  }

  function handleLine(line) {
    let m;
    if (line.startsWith('book ')) { if (bookSink) bookSink(line); return; }
    if ((m = /^info string book progress count=(\d+)/.exec(line))) {
      if (liveProgress) { process.stdout.write('\r' + `  xây sách: ${fmt(+m[1])} thế…`.padEnd(cols())); progressShown = true; }
      return;
    }
    if ((m = /^info string progress level=(\d+) nodes=(\d+) nps=(\d+) elapsedMs=(\d+) saving=(\d)/.exec(line))) {
      if (liveProgress) showProgress(+m[1], +m[2], +m[3], +m[4], m[5] === '1');
      return;
    }
    if ((m = /^info depth (\d+) score (cp|mate) (-?\d+) nodes (\d+) time (\d+)(?: pv (.*))?/.exec(line))) {
      state.depthDone = +m[1];
      state.accumulatedMs = +m[5];
      if (m[2] === 'mate') lastMate = { budget: +m[1], k: +m[3], nodes: +m[4], timeMs: +m[5], pv: m[6] ? m[6].split(' ') : [] };
      if (!quiet) {
        if (m[2] === 'mate') console.log(`  mức ${m[1]}: CHIẾU BÍ trong ${Math.abs(+m[3])} nước  (${fmt(m[4])} nút, tổng ${fmtMs(+m[5])})`);
        else console.log(`  mức ${m[1]}: chưa có thắng ép  (${fmt(m[4])} nút, tổng ${fmtMs(+m[5])})`);
      }
    } else if ((m = /^info string checkpoint loaded .*completed=(\d+) active=(\d+) mate=(\d) accumulatedMs=(\d+)/.exec(line))) {
      state.loaded = { completed: +m[1], active: +m[2], mate: m[3] === '1', accumulatedMs: +m[4] };
      if (!quiet) console.log(`Đã nạp tiến độ cũ: đã quét xong tới mức ${m[1]}${+m[2] > +m[1] ? `, đang dở mức ${m[2]}` : ''}, đã dò ${fmtMs(+m[4])} ở các lần trước.`);
    } else if ((m = /^info string checkpoint none/.exec(line))) {
      if (!quiet) console.log('Chưa có tiến độ lưu cho thế này — phân tích từ đầu.');
    } else if ((m = /^info string checkpoint ignored reason=(\S+)/.exec(line))) {
      if (!quiet) console.log(`Bỏ qua tiến độ cũ (${m[1]}) — phân tích từ đầu.`);
    } else if ((m = /^info string checkpoint saved .*completed=(\d+) active=(\d+) .*bytes=(\d+)/.exec(line))) {
      state.saved = { completed: +m[1], active: +m[2], bytes: +m[3] };
      if (!quiet) console.log(`  [đã lưu tiến độ: quét xong tới mức ${m[1]}, ${(+m[3] / 1048576).toFixed(1)} MB]`);
    } else if (/^info string checkpoint ERROR/.test(line)) {
      console.error(line);
    } else if ((m = /^info string outcome (\S+)/.exec(line))) {
      state.outcome = m[1];
    } else if (/^info string analyze resumed result=cached/.test(line)) {
      if (!quiet) console.log('Kết quả đã có từ lần chạy trước — trả ngay, không dò lại.');
    } else if ((m = /^bestmove (\S+)/.exec(line))) {
      state.best = m[1];
    } else if (/^info string ERROR/.test(line)) {
      console.error(line);
    }
  }

  // ---- cấu hình chung ----
  sess.send('bruteforce');
  sess.send('setoption name DataDir value ' + o.data);
  sess.send('setoption name AutosaveSec value ' + o.autosave);
  sess.send('setoption name HashBits value ' + o.hashBits);
  sess.send('setoption name WitnessLimit value ' + o.witnessLimit);
  sess.send('setoption name KeepAwake value ' + (o.allowSleep ? 'false' : 'true'));
  const threads = o.threads === 'auto' ? Math.max(1, Math.floor(os.cpus().length / 2)) : parseInt(o.threads, 10);
  sess.send('setoption name Threads value ' + threads);
  if (o.fen) for (const [n, v] of ruleOptions(o)) sess.send(`setoption name ${n} value ${v}`);

  const quit = async () => { try { sess.send('quit'); } catch (_) {} setTimeout(() => { try { child.kill(); } catch (_) {} }, 1500); };

  if (o.list) {
    sess.send('checkpoint list');
    await sess.waitFor((l) => l.startsWith('info string checkpoint list'));
    const items = sess.lines.filter((l) => l.startsWith('info string checkpoint item'));
    if (!items.length) console.log('Chưa có tiến độ nào trong ' + o.data);
    for (const l of items) {
      const f = parseKv(l);
      if (f.status) { console.log(`${f.file}: không đọc được`); continue; }
      const result = f.mate === '1' ? `mate ${f.mateK}` : `chưa có mate (quét xong tới mức ${f.completed})`;
      console.log(`${f.file}  ${result}  đã dò ${fmtMs(+f.accumulatedMs)} / ${f.slices} lát  ${(+f.bytes / 1048576).toFixed(1)} MB\n    FEN: ${f.fen.replace(/_/g, ' ')}`);
    }
    await quit();
    return 0;
  }

  sess.send('position fen ' + o.fen.trim());
  if (o.book) {
    const database = sqlite && sqlite.open(o.data);
    if (!database) { console.error('Cần Node >= 22.5 (node:sqlite) để lưu sách đáp án.'); await quit(); return 1; }
    await sess.waitFor((l) => l === 'bruteforceok');
    if (!sess.lines.some((l) => l.startsWith('info string features') && /\bbook\b/.test(l))) {
      console.error('Engine hiện có chưa hỗ trợ sách đáp án — hãy dựng lại bằng build.ps1.');
      await quit();
      return 1;
    }
    const restrictedWant = { none: 0, red: 1, black: 2, both: 3, analysis: (o.fen.trim().split(/\s+/)[1] === 'b') ? 1 : 2 }[o.rule];
    const all = await store.listCheckpoints(o.data);   // đồng bộ DB bên trong
    const item = all.find((it) => it.fen === o.fen.trim() && it.restricted === restrictedWant && it.limit === o.limit && it.bonus === o.bonus && it.ktc === o.ktc);
    if (!item || !item.mate) { console.error('Thế này chưa có mate được lưu — hãy phân tích tới khi ra mate trước (cùng luật).'); await quit(); return 2; }
    const positionId = database.upsert(item);
    database.bookClear(positionId);
    let batch = [];
    let total = 0;
    const flush = () => { if (batch.length) { database.bookInsert(positionId, batch); total += batch.length; batch = []; } };
    bookSink = (line) => {
      const t = line.split(' ');   // book <A|D> <fen_> <csR> <csB> <move> <mateK> <rb> <bb>
      if (t.length < 9) return;
      batch.push({ kind: t[1], fen: t[2].replace(/_/g, ' '), csRed: +t[3], csBlack: +t[4], move: t[5], mateIn: +t[6], budgetRed: +t[7], budgetBlack: +t[8] });
      if (batch.length >= 20000) flush();
    };
    const mateN = Math.abs(item.mateK);
    const depthN = o.bookDepth < 0 ? mateN : (o.bookDepth > 0 ? o.bookDepth : Math.ceil(mateN / 2));
    if (!quiet) console.log(`Phân tích sách đáp án cho thế mate ${mateN}: lưu MỌI nước (Đỏ & Đen) của ${depthN} nước công đầu; phần sau để engine giải khi chơi. Bị dừng thì lần sau làm tiếp.`);
    const t0 = Date.now();
    sess.send('book build' + (o.bookMax > 0 ? ' max ' + o.bookMax : '') + ' depth ' + (o.bookDepth || 0) + ' dev ' + o.bookDev + (o.fresh ? ' fresh' : ''));
    const end = await sess.waitFor((l) => /^info string book (done|ERROR)/.test(l));
    flush();
    bookSink = null;
    database.checkpoint();
    await quit();
    if (/ERROR/.test(end)) { console.error(end); return 1; }
    const dm = /count=(\d+) unresolved=(\d+) truncated=(\d)/.exec(end);
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    if (o.json) console.log(JSON.stringify({ book: true, positions: total, unresolved: dm ? +dm[2] : null, truncated: dm ? dm[3] === '1' : null, seconds: +seconds }));
    else {
      console.log(`\n=== Đã xây sách đáp án: ${fmt(total)} thế trong ${seconds} giây${dm && +dm[2] ? `, ${dm[2]} thế không giải được` : ''}${dm && dm[3] === '1' ? ' (bị cắt ở giới hạn --book-max)' : ''} ===`);
      console.log(`Lưu trong ${database.file}. Tra nước thắng: node analysis.cjs --guide --fen "<FEN hiện tại>"`);
    }
    return 0;
  }
  if (o.clear || o.fresh) {
    sess.send('checkpoint clear');
    const l = await sess.waitFor((x) => x.startsWith('info string checkpoint clear'));
    if (!quiet || o.clear) console.log(/removed=1/.test(l) ? 'Đã xoá tiến độ đã lưu của thế này.' : 'Không có tiến độ nào để xoá.');
    if (o.clear) { await quit(); return 0; }
  }

  if (!quiet) {
    console.log(`Thế: ${o.fen.trim()}`);
    console.log(`Luật chiếu: ${o.rule}${o.rule === 'analysis' || o.rule === 'both' || o.rule === 'red' || o.rule === 'black' ? ` (tối đa ${o.limit} lần)` : ''} · budget tối đa ${o.budget} · ${threads} luồng · lưu tiến độ ở ${o.data}`);
    console.log('Nhấn Ctrl+C để dừng (tiến độ được lưu, chạy lại đúng lệnh này để tiếp tục).');
  }
  sess.send(`analyze budget ${o.budget}${o.time > 0 ? ' movetime ' + Math.round(o.time * 1000) : ''}`);

  let interrupted = false;
  // Mọi tín hiệu tắt (Ctrl+C, đóng cửa sổ, kill, logoff) đều dẫn tới: bảo engine dừng và LƯU, đợi nó xong rồi mới thoát.
  const onStop = (name) => {
    if (interrupted && name === 'SIGINT') { try { child.kill(); } catch (_) {} process.exit(130); }
    interrupted = true;
    if (!quiet) console.log('\nĐang dừng và lưu tiến độ… (Ctrl+C lần nữa để thoát ngay, không lưu)');
    try { sess.send('stop'); } catch (_) {}
    // Phòng engine treo: sau 60 giây không xong thì thoát.
    setTimeout(() => { try { child.kill(); } catch (_) {} process.exit(130); }, 60000).unref();
  };
  for (const sig of ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGBREAK']) {
    try { process.on(sig, () => onStop(sig)); } catch (_) { /* tín hiệu không có trên hệ điều hành này */ }
  }
  child.on('exit', () => { if (!state.best) { console.error('Engine thoát bất ngờ.'); process.exit(1); } });

  await sess.waitFor((l) => l.startsWith('bestmove'));
  await quit();

  const pvComplete = !!(lastMate && lastMate.pv.length >= 2 * Math.abs(lastMate.k) - 1);
  const result = { outcome: state.outcome, pvComplete: lastMate ? pvComplete : null, bestmove: state.best, mate: lastMate && state.outcome === 'mate' ? lastMate : null,
    completedLevel: state.saved ? state.saved.completed : state.depthDone, accumulatedMs: state.accumulatedMs,
    resumedFrom: state.loaded, checkpointDir: o.data, interrupted };
  if (o.json) {
    console.log(JSON.stringify(result));
  } else if (state.outcome === 'mate' && lastMate) {
    console.log(`\n=== CHIẾU BÍ trong ${Math.abs(lastMate.k)} nước (${lastMate.k > 0 ? 'bên đi trước thắng' : 'bên đi trước bị ép thua'}) ===`);
    console.log('Nước đầu: ' + state.best);
    console.log('Tuyến:    ' + lastMate.pv.join(' ') + (pvComplete ? '' : '   (tuyến chưa đầy đủ — mate vẫn đúng; thêm --witness-limit 3000000 rồi chạy lại với --new để có tuyến đủ)'));
    console.log(`Tổng thời gian dò (mọi lần chạy): ${fmtMs(lastMate.timeMs)} · ${fmt(lastMate.nodes)} nút`);
  } else if (state.outcome === 'draw') {
    console.log(`\n=== Không có thắng ép trong ${o.budget} nước mỗi bên (đã quét trọn). ===`);
  } else {
    console.log(`\n=== Chưa kết luận: đã quét xong tới mức ${result.completedLevel}. Chạy lại đúng lệnh này để tiếp tục. ===`);
  }
  return state.outcome === 'mate' ? 0 : state.outcome === 'draw' ? 2 : 3;
}


  return { main, HELP };
})();

// ===================== 3. Menu điều khiển bằng phím =====================
const menu = (() => {

const ROOT = APP_DIR;
const DATA = process.env.PHANTICH_DATA ? path.resolve(process.env.PHANTICH_DATA) : path.join(ROOT, 'data');
const FEN_RE = /^[rnbakcpRNBAKCP1-9/]+ [wb]\b/;
const scripted = process.env.PHANTICH_KEYS ? process.env.PHANTICH_KEYS.split('|') : null;
const isTTY = !!(process.stdout.isTTY && process.stdin.isTTY);

// ===================== nhập phím =====================
const queue = [];
const waiters = [];
let keysEnabled = true;   // tắt khi đang nhập dòng ở chế độ thường (để dán được)
function pushKey(k) { const w = waiters.shift(); if (w) w(k); else queue.push(k); }

function startKeys() {
  if (scripted) return;
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', (str, key) => {
    if (!keysEnabled) return;
    key = key || {};
    if (key.ctrl && key.name === 'c') return pushKey({ name: 'quit' });
    const names = { up: 'up', down: 'down', left: 'left', right: 'right', return: 'enter', enter: 'enter', escape: 'esc',
      backspace: 'backspace', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown', tab: 'tab', delete: 'delete' };
    if (names[key.name]) return pushKey({ name: names[key.name] });
    if (str && !key.ctrl && !key.meta && str >= ' ') return pushKey({ name: 'char', ch: str });
  });
}
function pauseKeys() { if (!scripted && process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); } }
function resumeKeys() { if (!scripted && process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); } }

let scriptPos = 0;
function nextKey() {
  if (scripted) {
    // Hết kịch bản: thoát an toàn (tránh treo khi kiểm thử).
    if (scriptPos >= scripted.length) return Promise.resolve({ name: 'quit' });
    const tok = scripted[scriptPos++].trim();
    if (tok.startsWith('text:')) return Promise.resolve({ name: 'text', text: tok.slice(5) });
    const map = { up: 'up', down: 'down', enter: 'enter', esc: 'esc', back: 'esc', q: 'quit', quit: 'quit', any: 'enter', home: 'home', end: 'end', backspace: 'backspace' };
    if (map[tok]) return Promise.resolve({ name: map[tok] });
    if (/^[0-9]$/.test(tok)) return Promise.resolve({ name: 'char', ch: tok });
    return nextKey();
  }
  if (queue.length) return Promise.resolve(queue.shift());
  return new Promise((resolve) => waiters.push(resolve));
}

// ===================== hiển thị =====================
const out = (s = '') => process.stdout.write(s + '\n');
const INV = isTTY ? '\x1b[7m' : '';
const DIM = isTTY ? '\x1b[2m' : '';
const BOLD = isTTY ? '\x1b[1m' : '';
const GREEN = isTTY ? '\x1b[32m' : '';
const YELLOW = isTTY ? '\x1b[33m' : '';
const RST = isTTY ? '\x1b[0m' : '';
function clear() { if (isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); else out('\n' + '='.repeat(60)); }
const width = () => Math.max(40, (process.stdout.columns || 100) - 2);
const cut = (s, n) => (s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…');

function boardText(fen) {
  const rows = fen.trim().split(/\s+/)[0].split('/');
  if (rows.length !== 10) return [];
  const lines = ['    a b c d e f g h i'];
  rows.forEach((r, idx) => {
    let cells = '';
    for (const ch of r) cells += /\d/.test(ch) ? '· '.repeat(+ch) : ch + ' ';
    lines.push(`${9 - idx}   ${cells.trimEnd()}   ${9 - idx}`);
    if (idx === 4) lines.push('    ~ ~ ~ sông ~ ~ ~ ~');
  });
  lines.push('    a b c d e f g h i', '    (chữ HOA = Đỏ, chữ thường = Đen)');
  return lines;
}

/**
 * Hiện danh sách chọn bằng phím. Trả về chỉ số mục (>=0), -1 = quay lại (Esc/←), -2 = thoát hẳn (q / Ctrl+C).
 * items: [{label, hint?, disabled?}]
 */
async function select({ title, info = [], items, start = 0, hint = '↑/↓ chọn · Enter xác nhận · Esc quay lại · q thoát' }) {
  let sel = Math.min(Math.max(0, start), Math.max(0, items.length - 1));
  while (items.length && items[sel] && items[sel].disabled) sel = (sel + 1) % items.length;
  for (;;) {
    clear();
    out(`${BOLD}${title}${RST}`);
    out(DIM + '─'.repeat(Math.min(width(), 70)) + RST);
    for (const line of info) out(line);
    if (info.length) out('');
    const rows = Math.max(5, (process.stdout.rows || 30) - info.length - 8);
    const top = Math.max(0, Math.min(sel - Math.floor(rows / 2), items.length - rows));
    const shown = items.slice(top, top + rows);
    if (top > 0) out(DIM + '   ↑ còn nữa…' + RST);
    shown.forEach((it, i) => {
      const idx = top + i;
      const num = idx < 9 ? `${idx + 1}. ` : '   ';
      const text = cut(`${num}${it.label}`, width() - 4);
      if (idx === sel) out(`${INV}▶ ${text}${RST}`);
      else out(`  ${it.disabled ? DIM : ''}${text}${it.disabled ? RST : ''}`);
    });
    if (top + rows < items.length) out(DIM + '   ↓ còn nữa…' + RST);
    out('');
    if (items[sel] && items[sel].hint) out(YELLOW + items[sel].hint + RST);
    out(DIM + hint + RST);
    const key = await nextKey();
    const step = (d) => { let n = sel; do { n = (n + d + items.length) % items.length; } while (items[n].disabled && n !== sel); sel = n; };
    switch (key.name) {
      case 'up': if (items.length) step(-1); break;
      case 'down': case 'tab': if (items.length) step(1); break;
      case 'home': sel = 0; break;
      case 'end': sel = Math.max(0, items.length - 1); break;
      case 'pageup': sel = Math.max(0, sel - rows); break;
      case 'pagedown': sel = Math.min(items.length - 1, sel + rows); break;
      case 'enter': if (items[sel] && !items[sel].disabled) return sel; break;
      case 'esc': case 'left': case 'backspace': return -1;
      case 'quit': return -2;
      case 'char':
        if (key.ch === 'q' || key.ch === 'Q') return -2;
        if (key.ch === 'k') { if (items.length) step(-1); break; }
        if (key.ch === 'j') { if (items.length) step(1); break; }
        if (key.ch === ' ') { if (items[sel] && !items[sel].disabled) return sel; break; }
        if (/^[1-9]$/.test(key.ch)) { const i = +key.ch - 1; if (items[i] && !items[i].disabled) return i; }
        break;
      default: break;
    }
  }
}

/** Nhập một dòng (dán FEN được). Trả về chuỗi, hoặc null nếu bấm Esc. */
async function promptLine(label, initial = '') {
  if (!scripted && isTTY) {
    // Chế độ nhập dòng THƯỜNG của console (không phải chế độ phím thô) để dán được: chuột phải / Ctrl+V /
    // Ctrl+Shift+V đều hoạt động. Để trống rồi Enter = huỷ/quay lại.
    keysEnabled = false;
    pauseKeys();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const answer = await new Promise((resolve) => {
      rl.on('close', () => resolve(null));
      rl.question(label, (a) => resolve(a));
    });
    rl.close();
    queue.length = 0;   // bỏ phím còn sót (ví dụ ký tự của lần dán)
    keysEnabled = true;
    resumeKeys();
    return answer;
  }
  let text = initial;
  const draw = () => {
    if (isTTY) process.stdout.write(`\r\x1b[2K${label}${text}`);
  };
  if (!isTTY && !scripted) return null;
  out(label.replace(/: $/, ':'));
  draw();
  for (;;) {
    const key = await nextKey();
    if (key.name === 'text') { out(key.text); return key.text; }
    if (key.name === 'enter') { if (isTTY) out(''); return text; }
    if (key.name === 'esc' || key.name === 'quit') { if (isTTY) out(''); return null; }
    if (key.name === 'backspace') { text = text.slice(0, -1); draw(); }
    else if (key.name === 'char') { text += key.ch; draw(); }
  }
}

async function pause(msg = 'Nhấn phím bất kỳ để quay lại menu…') {
  out('');
  out(DIM + msg + RST);
  const k = await nextKey();
  return k.name === 'quit' ? -2 : 0;
}

// ===================== chạy phân tích (tiến trình con, Ctrl+C dừng + lưu) =====================
function runAnalyze(args) {
  return new Promise((resolve) => {
    pauseKeys();   // trả Ctrl+C về cho tiến trình con xử lý (dừng + lưu), không để menu nuốt
    const onSigint = () => { /* menu không thoát; tiến trình con tự dừng và lưu */ };
    process.on('SIGINT', onSigint);
    const child = spawn(process.execPath, sea ? args : [__filename, ...args], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: false });
    child.on('exit', (code) => { process.off('SIGINT', onSigint); resumeKeys(); resolve(code); });
    child.on('error', () => { process.off('SIGINT', onSigint); resumeKeys(); resolve(1); });
  });
}

// ===================== các màn hình =====================
async function confirm(question, yes = 'Có', no = 'Không') {
  const i = await select({ title: question, items: [{ label: no }, { label: yes }], hint: '↑/↓ chọn · Enter xác nhận · Esc huỷ' });
  return i === 1;
}

function itemInfo(item) {
  const lines = [];
  lines.push(`${BOLD}FEN:${RST} ${item.fen}`);
  const state = item.mate
    ? `${GREEN}CÓ MATE: ${Math.abs(item.mateK)} nước${RST} (${item.mateK > 0 ? 'bên đi trước thắng' : 'bên đi trước bị ép thua'})`
    : item.group === 'complete'
      ? `Đã quét trọn tới ${item.requested} nước mỗi bên: không có thắng ép`
      : `${YELLOW}Chưa có mate${RST}: đã quét xong tới mức ${item.completed}${item.requested ? ` trên tối đa ${item.requested}` : ''}${item.active > item.completed ? `, đang dở mức ${item.active}` : ''}`;
  lines.push(`${BOLD}Kết quả:${RST} ${state}`);
  lines.push(`${BOLD}Luật chiếu:${RST} ${store.ruleLabel(item)}${item.bonus ? ' + cản-ăn' : ''}${item.ktc ? ' + ktc' : ''}`);
  if (item.mate) {
    const n = bookCountOf(DATA, item);
    lines.push(`${BOLD}Sách đáp án:${RST} ${n === null ? 'không có SQLite (cần Node >= 22.5)' : n > 0 ? `${GREEN}${n.toLocaleString('vi-VN')} thế${RST} (dùng để hướng dẫn chơi)` : 'chưa xây'}`);
  }
  lines.push(`${BOLD}Đã dò:${RST} ${store.fmtMs(item.accumulatedMs)} qua ${item.slices} lát · tiến độ ${(item.bytes / 1048576).toFixed(1)} MB · lần cuối ${store.fmtTime(item.mtimeMs)}`);
  lines.push('', ...boardText(item.fen).map((l) => DIM + l + RST));
  return lines;
}

// Hướng dẫn chơi theo sách đáp án: hiện nước thắng, nhập nước đáp của đối phương (dạng h2e2), tra tiếp.
async function guideScreen(item) {
  const database = sqlite && sqlite.open(DATA);
  if (!database) { out('Cần Node >= 22.5 (node:sqlite).'); return (await pause('Nhấn phím bất kỳ…')) === -2 ? -2 : 0; }
  if (!bookCountOf(DATA, item)) { clear(); out('Chưa xây sách đáp án cho thế này. Chọn "Xây / cập nhật sách đáp án" trước.'); return (await pause('Nhấn phím bất kỳ…')) === -2 ? -2 : 0; }
  let fen = item.fen;
  let steps = 0;
  const attackerUpper = fen.split(' ')[1] === 'w';
  for (;;) {
    const hit = database.lookup(fen);
    clear();
    out(`${BOLD}Hướng dẫn chơi${RST} — nước thứ ${steps + 1} của bạn (${attackerUpper ? 'Đỏ' : 'Đen'})`);
    out(DIM + '─'.repeat(40) + RST);
    for (const l of boardText(fen)) out(DIM + l + RST);
    out('');
    if (!hit) {
      out(YELLOW + 'Thế này không có trong sách: nước của đối phương có thể sai luật hoặc nằm ngoài cây chứng minh.' + RST);
      return (await pause('Nhấn phím bất kỳ để quay lại…')) === -2 ? -2 : 0;
    }
    out(`${GREEN}${BOLD}Nước thắng: ${hit.move}${RST}  ${hit.mate_in === 1 ? '→ CHIẾU BÍ ngay!' : `(chiếu bí sau ${hit.mate_in} nước của bạn)`}`);
    if (hit.mate_in === 1) return (await pause('Hoàn tất. Nhấn phím bất kỳ để quay lại…')) === -2 ? -2 : 0;
    out('');
    const v = await promptLine('Sau khi bạn đi, nhập nước đáp của đối phương (ví dụ h2e2; để trống = quay lại): ');
    if (v === null || v.trim() === '') return 0;
    const mine = applyUci(fen, hit.move);
    const theirs = mine && applyUci(mine.fen, v.trim());
    if (!theirs) { out('Nước không hợp lệ (định dạng a0..i9, quân phải có ở ô xuất phát).'); if ((await pause('Nhấn phím bất kỳ để nhập lại…')) === -2) return -2; continue; }
    const theirPieceIsAttacker = attackerUpper ? theirs.piece === theirs.piece.toUpperCase() : theirs.piece === theirs.piece.toLowerCase();
    if (theirPieceIsAttacker) { out('Đó là quân của bạn, không phải của đối phương.'); if ((await pause('Nhấn phím bất kỳ để nhập lại…')) === -2) return -2; continue; }
    fen = theirs.fen;
    steps++;
  }
}

async function itemScreen(item) {
  for (;;) {
    const items = [];
    const acts = [];
    const add = (label, act, hint) => { items.push({ label, hint }); acts.push(act); };
    if (item.mate) {
      add('Xem kết quả (nước đầu và tuyến)', 'view');
      add('Hướng dẫn chơi theo sách đáp án', 'guide', 'Hiện nước thắng, bạn nhập nước đáp của đối phương để nhận nước kế tiếp.');
      add('Phân tích sách đáp án (nửa mate, mọi nước)', 'book', 'Lưu MỌI nước Đỏ & Đen của nửa đầu mate vào SQLite (analysis.db); nửa sau để engine giải. Bị dừng thì chạy lại sẽ làm tiếp.');
      add('Phân tích lại từ đầu', 'redo', 'Bỏ tiến độ đã lưu rồi dò lại.');
    } else if (item.group === 'complete') {
      add('Xem kết quả', 'view');
      add('Tăng số nước tối đa và dò tiếp', 'deeper', `Tiếp tục từ mức ${item.completed}, không dò lại các mức đã quét.`);
      add('Phân tích lại từ đầu', 'redo');
    } else {
      add('Tiếp tục phân tích', 'continue', `Tiếp tục từ mức đã quét xong (${item.completed}); chạy tới khi có kết quả hoặc nhấn Ctrl+C để dừng.`);
      add('Tiếp tục có giới hạn thời gian…', 'continue-time');
      add('Tăng số nước tối đa và tiếp tục…', 'deeper');
      add('Phân tích lại từ đầu', 'redo');
    }
    add('Xem lịch sử lưu (tốc độ, độ đầy bảng băm, thời gian lưu)', 'history');
    add('Xoá tiến độ của thế này', 'delete');
    add('← Quay lại danh sách', 'back');
    if (item.roots) items.unshift({ label: '(thế này có trạng thái chiếu gốc đặc biệt, không tiếp tục được từ menu)', disabled: true }), acts.unshift('none');
    const i = await select({ title: `Thế đã phân tích`, info: itemInfo(item), items });
    if (i === -2) return -2;
    if (i === -1) return 0;
    const act = acts[i];
    if (act === 'back') return 0;
    if (act === 'book') {
      clear();
      await runAnalyze(store.argsFor(item, DATA, ['--book']));
      if (await pause() === -2) return -2;
      return 1;
    }
    if (act === 'guide') {
      if ((await guideScreen(item)) === -2) return -2;
      continue;
    }
    if (act === 'history') {
      clear();
      const rows = store.readHistory(DATA, item.file);
      out(`${BOLD}Lịch sử lưu${RST} — ${item.fen}`);
      out(DIM + '(chỉ có các lần lưu sau khi bật tính năng ghi lịch sử; cột nút/giây tính giữa hai lần lưu liên tiếp)' + RST);
      out('');
      if (!rows.length) out('Chưa có lịch sử cho thế này.');
      else {
        out('Giờ lưu              Mức   Tổng đã dò      Nút/giây     Bảng đầy   Tệp      Lưu mất');
        for (const r of rows.slice(-18)) {
          out([r.time.replace('T', ' ').padEnd(19), `${r.completed}/${r.active}`.padEnd(5), store.fmtMs(r.accumulatedMs).padEnd(15),
            (r.nps ? Math.round(r.nps).toLocaleString('vi-VN') : '–').padStart(11), (r.fill != null ? Math.round(r.fill * 100) + '%' : '–').padStart(9),
            ((r.bytes / 1048576).toFixed(0) + ' MB').padStart(8), (r.saveMs / 1000).toFixed(1).padStart(6) + ' s'].join('  '));
        }
        if (rows.length > 18) out(DIM + `… ${rows.length - 18} dòng cũ hơn không hiện` + RST);
      }
      if (await pause() === -2) return -2;
      continue;
    }
    if (act === 'view' || act === 'continue') {
      clear();
      await runAnalyze(store.argsFor(item, DATA));
      if (await pause() === -2) return -2;
      return 1;   // làm mới danh sách
    }
    if (act === 'continue-time') {
      const v = await promptLine('Giới hạn thời gian của lần chạy này (giây): ');
      if (v === null) continue;
      const sec = parseFloat(v);
      if (!(sec > 0)) { out('Số giây không hợp lệ.'); if (await pause('Nhấn phím bất kỳ…') === -2) return -2; continue; }
      clear();
      await runAnalyze(store.argsFor(item, DATA, ['--time', String(sec)]));
      if (await pause() === -2) return -2;
      return 1;
    }
    if (act === 'deeper') {
      const v = await promptLine(`Số nước tối đa mới (hiện ${item.requested || item.completed}, tối đa 60): `);
      if (v === null) continue;
      const n = parseInt(v, 10);
      if (!(n > (item.requested || item.completed) && n <= 60)) { out('Phải lớn hơn mức hiện tại và không quá 60.'); if (await pause('Nhấn phím bất kỳ…') === -2) return -2; continue; }
      clear();
      const args = store.argsFor(item, DATA);
      args[args.indexOf('--budget') + 1] = String(n);
      await runAnalyze(args);
      if (await pause() === -2) return -2;
      return 1;
    }
    if (act === 'redo') {
      if (!(await confirm('Bỏ toàn bộ tiến độ đã lưu của thế này và dò lại từ đầu?', 'Có, dò lại từ đầu'))) continue;
      clear();
      await runAnalyze(store.argsFor(item, DATA, ['--new']));
      if (await pause() === -2) return -2;
      return 1;
    }
    if (act === 'delete') {
      if (!(await confirm('Xoá tiến độ đã lưu của thế này? (không hoàn tác được)', 'Có, xoá'))) continue;
      clear();
      await runAnalyze(store.argsFor(item, DATA, ['--clear']));
      if (await pause() === -2) return -2;
      return 1;
    }
  }
}

async function groupScreen(groupKey) {
  for (;;) {
    const all = await store.listCheckpoints(DATA);
    const items = all.filter((it) => it.group === groupKey);
    if (!items.length) {
      clear();
      out(`${BOLD}${store.GROUPS[groupKey]}${RST}`);
      out('');
      out('Chưa có thế nào trong nhóm này.');
      return (await pause('Nhấn phím bất kỳ để quay lại…')) === -2 ? -2 : 0;
    }
    const i = await select({
      title: `${store.GROUPS[groupKey]} (${items.length})`,
      info: [DIM + 'Mới nhất ở trên cùng. Chọn một thế để xem, tiếp tục, dò lại hoặc xoá.' + RST],
      items: items.map((it) => ({
        label: `[${store.resultText(it)}] ${it.fen}  · ${store.fmtMs(it.accumulatedMs)} · ${store.fmtTime(it.mtimeMs)}`,
      })),
    });
    if (i === -2) return -2;
    if (i === -1) return 0;
    const r = await itemScreen(items[i]);
    if (r === -2) return -2;
  }
}

async function previousScreen() {
  for (;;) {
    const all = await store.listCheckpoints(DATA);
    const count = (g) => all.filter((it) => it.group === g).length;
    if (!all.length) {
      clear();
      out(`${BOLD}Các thế đã phân tích trước đó${RST}`);
      out('');
      out('Chưa có thế nào được lưu. Hãy chọn "Phân tích thế mới" trước.');
      return (await pause('Nhấn phím bất kỳ để quay lại…')) === -2 ? -2 : 0;
    }
    const groups = ['mate', 'partial', 'complete'];
    const i = await select({
      title: `Các thế đã phân tích trước đó (${all.length})`,
      items: groups.map((g) => ({ label: `${store.GROUPS[g]}  (${count(g)})`, disabled: count(g) === 0 })),
    });
    if (i === -2) return -2;
    if (i === -1) return 0;
    const r = await groupScreen(groups[i]);
    if (r === -2) return -2;
  }
}

const RULES = ['analysis', 'both', 'red', 'black', 'none'];
const RULE_TEXT = { analysis: 'Phân Tích (bên đi sau chiếu tối đa 2 lần)', both: 'cả hai bên bị giới hạn', red: 'chỉ Đỏ bị giới hạn', black: 'chỉ Đen bị giới hạn', none: 'tắt luật chiếu' };

async function newScreen() {
  let fen = null;
  for (;;) {
    clear();
    out(`${BOLD}Phân tích thế MỚI${RST}`);
    out(DIM + '─'.repeat(40) + RST);
    out('Dán FEN của thế cờ (chuột phải hoặc Ctrl+V) rồi nhấn Enter. Để trống + Enter để quay lại.');
    out(DIM + 'Ví dụ: 9/4PP3/5k3/9/5c2r/5R3/9/9/9/4K4 w - - 0 1' + RST);
    out('');
    const v = await promptLine('FEN: ');
    if (v === null || (isTTY && !scripted && v.trim() === '')) return 0;
    if (!FEN_RE.test(v.trim()) || v.trim().split('/').length !== 10) {
      out(YELLOW + 'FEN không hợp lệ (cần 10 hàng và bên đi w/b).' + RST);
      if (await pause('Nhấn phím bất kỳ để nhập lại…') === -2) return -2;
      continue;
    }
    fen = v.trim();
    break;
  }
  const s = { budget: 15, time: 0, threads: 'auto', rule: 'analysis', limit: 2 };
  const autoThreads = Math.max(1, Math.floor(os.cpus().length / 2));
  for (;;) {
    const existing = (await store.listCheckpoints(DATA)).find((it) => it.fen === fen && !it.bonus && !it.ktc
      && it.restricted === ({ none: 0, red: 1, black: 2, both: 3, analysis: fen.split(/\s+/)[1] === 'b' ? 1 : 2 }[s.rule]) && it.limit === s.limit);
    const info = [`${BOLD}FEN:${RST} ${fen}`];
    if (existing) info.push(`${YELLOW}Đã có tiến độ cho thế này (${store.resultText(existing)}, đã dò ${store.fmtMs(existing.accumulatedMs)}) — sẽ TIẾP TỤC từ đó.${RST}`);
    info.push('', ...boardText(fen).map((l) => DIM + l + RST));
    const items = [
      { label: existing ? '▶ Tiếp tục phân tích' : '▶ Bắt đầu phân tích', hint: 'Chạy tới khi có kết quả; nhấn Ctrl+C để dừng và lưu, lần sau chạy tiếp.' },
      { label: `Số nước tối đa mỗi bên: ${s.budget}` },
      { label: `Giới hạn thời gian: ${s.time > 0 ? s.time + ' giây' : 'không giới hạn'}` },
      { label: `Số luồng: ${s.threads === 'auto' ? `tự động (${autoThreads})` : s.threads}` },
      { label: `Luật chiếu liên tục: ${RULE_TEXT[s.rule]}`, hint: 'Enter để đổi sang luật kế tiếp.' },
      { label: '← Quay lại' },
    ];
    const i = await select({ title: 'Phân tích thế mới — cài đặt', info, items });
    if (i === -2) return -2;
    if (i === -1 || i === 5) return 0;
    if (i === 1) {
      const v = await promptLine(`Số nước tối đa mỗi bên (1-60, hiện ${s.budget}): `);
      const n = v === null ? NaN : parseInt(v, 10);
      if (n >= 1 && n <= 60) s.budget = n;
    } else if (i === 2) {
      const v = await promptLine('Giới hạn thời gian (giây, 0 = không giới hạn): ');
      const n = v === null ? NaN : parseFloat(v);
      if (n >= 0) s.time = n;
    } else if (i === 3) {
      const v = await promptLine('Số luồng (số nguyên, hoặc để trống = tự động): ');
      if (v !== null) { const n = parseInt(v, 10); s.threads = n >= 1 ? n : 'auto'; }
    } else if (i === 4) {
      s.rule = RULES[(RULES.indexOf(s.rule) + 1) % RULES.length];
    } else if (i === 0) {
      clear();
      const args = ['--fen', fen, '--data', DATA, '--budget', String(s.budget), '--rule', s.rule, '--limit', String(s.limit), '--threads', String(s.threads)];
      if (s.time > 0) args.push('--time', String(s.time));
      await runAnalyze(args);
      return (await pause()) === -2 ? -2 : 1;
    }
  }
}

async function mainMenu() {
  let pos = 0;
  for (;;) {
    const all = await store.listCheckpoints(DATA).catch(() => []);
    const i = await select({
      title: 'PHÂN TÍCH THẾ CỜ — Brute-force (có lưu & tiếp tục tiến độ)',
      info: [DIM + `Tiến độ lưu ở: ${DATA}` + RST],
      items: [
        { label: 'Phân tích thế MỚI', hint: 'Nhập FEN rồi bắt đầu phân tích.' },
        { label: `Các thế đã phân tích trước đó (${all.length})`, hint: 'Nhóm: đã có mate · chưa có mate · đã quét trọn.', disabled: all.length === 0 },
        { label: 'Thoát' },
      ],
      start: pos,
      hint: '↑/↓ chọn · Enter xác nhận · q thoát',
    });
    if (i === -2 || i === -1 || i === 2) return;
    pos = i;
    const r = i === 0 ? await newScreen() : await previousScreen();
    if (r === -2) return;
  }
}

async function main() {
  if (!scripted && !isTTY && !process.env.PHANTICH_PIPE) {
    console.error('Menu cần chạy trong cửa sổ lệnh (cmd/PowerShell). Để dùng không tương tác: node analysis.cjs --help');
    process.exit(1);
  }
  if (!fs.existsSync(store.EXE)) { console.error('Chưa có engine: ' + store.EXE + ' (chạy build.ps1)'); process.exit(1); }
  fs.mkdirSync(DATA, { recursive: true });
  startKeys();
  try { await mainMenu(); }
  finally {
    pauseKeys();
    if (isTTY) process.stdout.write('\x1b[0m\n');
  }
}

const run = () => main().then(() => process.exit(0), (e) => { pauseKeys(); console.error(e); process.exit(1); });

  return { run };
})();

// ===================== 4. Điểm vào =====================
const argv = process.argv.slice(2);
if (argv.length === 0) {
  menu.run();
} else {
  cli.main().then((code) => { setTimeout(() => process.exit(code), 100); },
    (err) => { console.error('Lỗi: ' + err.message + '\n\n' + cli.HELP); process.exit(1); });
}
