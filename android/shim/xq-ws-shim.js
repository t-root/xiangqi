// Shim WebSocket cho bản APK: trang xiangqi-analyzer.html mở ws://localhost:8899 (Pikafish) và
// ws://localhost:8900 (Brute-force) — hoặc wss://<host>/ws/pikafish|bruteforce khi trang chạy https.
// Trong APK không có server.js, nên hai địa chỉ đó được nối thẳng vào WsBridge (Java) qua
// window.XQBridge; mọi WebSocket khác vẫn dùng WebSocket thật của trình duyệt.
(function () {
    if (window.__xqWsShim || !window.XQBridge) return;
    window.__xqWsShim = true;

    const NativeWS = window.WebSocket;
    const sockets = {};
    let nextId = 1;

    function engineKind(url) {
        const u = String(url);
        if (/\/ws\/pikafish(?:[?#]|$)/.test(u) || /:8899(?:[\/?#]|$)/.test(u)) return 'pikafish';
        if (/\/ws\/bruteforce(?:[?#]|$)/.test(u) || /:8900(?:[\/?#]|$)/.test(u)) return 'bruteforce';
        return null;
    }

    class XQSocket extends EventTarget {
        constructor(url, kind) {
            super();
            this.url = String(url);
            this.readyState = 0;
            this.binaryType = 'blob';
            this.bufferedAmount = 0;
            this.extensions = '';
            this.protocol = '';
            this.onopen = this.onmessage = this.onclose = this.onerror = null;
            this._id = nextId++;
            this._kind = kind;
            sockets[this._id] = this;
            // open() chờ file engine sẵn sàng rồi mới bật tiến trình, nên gọi ngoài luồng hiện tại.
            setTimeout(() => {
                if (this.readyState !== 0) return;
                try { window.XQBridge.open(this._id, this._kind); }
                catch (e) { this._fail(); return; }
                if (this.readyState !== 0) return;
                this.readyState = 1;
                this._emit('open', new Event('open'));
            }, 0);
        }
        _emit(type, event) {
            const handler = this['on' + type];
            if (typeof handler === 'function') {
                try { handler.call(this, event); } catch (e) { setTimeout(() => { throw e; }); }
            }
            this.dispatchEvent(event);
        }
        _fail() {
            this.readyState = 3;
            delete sockets[this._id];
            this._emit('error', new Event('error'));
            this._emit('close', new CloseEvent('close', { code: 1006, reason: '', wasClean: false }));
        }
        send(data) {
            if (this.readyState === 0) throw new DOMException('Still in CONNECTING state.', 'InvalidStateError');
            if (this.readyState !== 1) return;
            window.XQBridge.send(this._id, String(data));
        }
        close(code, reason) {
            if (this.readyState >= 2) return;
            const wasConnecting = this.readyState === 0;
            this.readyState = 2;
            if (!wasConnecting) window.XQBridge.close(this._id);
            setTimeout(() => {
                this.readyState = 3;
                delete sockets[this._id];
                this._emit('close', new CloseEvent('close', { code: code || 1000, reason: reason || '', wasClean: true }));
            }, 0);
        }
    }
    XQSocket.CONNECTING = XQSocket.prototype.CONNECTING = 0;
    XQSocket.OPEN = XQSocket.prototype.OPEN = 1;
    XQSocket.CLOSING = XQSocket.prototype.CLOSING = 2;
    XQSocket.CLOSED = XQSocket.prototype.CLOSED = 3;

    // Native -> trang: WsBridge gọi hàm này với mảng [id, type, data].
    window.__xqWs = function (batch) {
        for (const item of batch) {
            const sock = sockets[item[0]];
            if (!sock || sock.readyState !== 1) continue;
            if (item[1] === 'message') sock._emit('message', new MessageEvent('message', { data: item[2] }));
        }
    };

    function PatchedWebSocket(url, protocols) {
        const kind = engineKind(url);
        if (kind) return new XQSocket(url, kind);
        return protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
    }
    PatchedWebSocket.prototype = NativeWS.prototype;
    PatchedWebSocket.CONNECTING = 0;
    PatchedWebSocket.OPEN = 1;
    PatchedWebSocket.CLOSING = 2;
    PatchedWebSocket.CLOSED = 3;
    window.WebSocket = PatchedWebSocket;
})();
