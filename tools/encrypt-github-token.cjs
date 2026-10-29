// Mã hóa token GitHub bằng mật khẩu để đặt vào none.txt của repo droply.
// Dùng: node tools/encrypt-github-token.cjs "<token>" "<mật khẩu>" > none.txt
// Định dạng: salt.iv.ciphertext (base64) - khớp requestGithubPushToken() trong xiangqi-analyzer.html.
const crypto = require('crypto');
const [token, password] = process.argv.slice(2);
if (!token || !password) {
    console.error('Thiếu tham số: node tools/encrypt-github-token.cjs "<token>" "<mật khẩu>"');
    process.exit(1);
}
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
// WebCrypto AES-GCM mong đợi auth tag nằm cuối ciphertext
const data = Buffer.concat([encrypted, cipher.getAuthTag()]);
process.stdout.write([salt, iv, data].map(b => b.toString('base64')).join('.'));
