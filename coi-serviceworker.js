// coi-serviceworker.js
//
// Cho phép chạy 2 engine Web (Pikafish Web + Brute-force Web) khi trang được phục vụ bằng một
// máy chủ tĩnh BẤT KỲ (app web-server trên điện thoại, python, nginx...) mà không chỉnh được
// header. Hai engine này là WASM đa luồng nên cần SharedArrayBuffer, tức là trang phải ở trạng
// thái "cross-origin isolated" (COOP: same-origin + COEP: require-corp). File này đóng 2 vai:
//   • chạy trong trang (<script src>): đăng ký chính nó làm service worker rồi tải lại trang 1 lần;
//   • chạy trong service worker: chép từng response về và gắn thêm các header trên.
// Khi máy chủ đã tự đặt header (engine/server.js) thì crossOriginIsolated đã true → không làm gì.
// Điều kiện của trình duyệt: service worker chỉ chạy ở secure context, tức https:// hoặc
// http://localhost (mở trực tiếp trên máy đang chạy máy chủ). http://192.168.x.x thì không được.
if (typeof window === 'undefined') {
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', (e) => {
        const req = e.request;
        if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
        e.respondWith(
            fetch(req).then((res) => {
                if (res.status === 0) return res; // opaque — không sửa được header
                const headers = new Headers(res.headers);
                headers.set('Cross-Origin-Opener-Policy', 'same-origin');
                headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
                headers.set('Cross-Origin-Resource-Policy', 'same-origin');
                return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
            }).catch((err) => { console.error('[coi-sw]', err); return Response.error(); })
        );
    });
} else if (!window.crossOriginIsolated) {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
        console.warn('[coi] Không bật được cross-origin isolation: cần mở bằng http://localhost hoặc https://. Engine Web sẽ không chạy.');
    } else {
        const me = document.currentScript && document.currentScript.src;
        navigator.serviceWorker.register(me).then((reg) => {
            const reloadOnce = () => {
                if (sessionStorage.getItem('coi-reloaded')) return;
                sessionStorage.setItem('coi-reloaded', '1');
                location.reload();
            };
            if (reg.active && !navigator.serviceWorker.controller) reloadOnce();
            else navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
        }).catch((err) => console.error('[coi] Đăng ký service worker thất bại:', err));
    }
} else {
    sessionStorage.removeItem('coi-reloaded');
}
