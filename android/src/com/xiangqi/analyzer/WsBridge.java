package com.xiangqi.analyzer;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;

/**
 * Thay cho cầu nối WebSocket của engine/server.js: trang tưởng đang mở ws://localhost:8899/8900,
 * thực ra shim JS (xq-ws-shim.js) gọi thẳng các hàm này; mỗi "kết nối" là một tiến trình engine riêng.
 */
final class WsBridge {
    private static final String TAG = "XQBridge";
    private static final String NNUE_ASSET = "engines/pikafish.nnue";

    private final Context ctx;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ConcurrentHashMap<Integer, EngineSession> sessions = new ConcurrentHashMap<>();
    private final CountDownLatch filesReady = new CountDownLatch(1);
    private volatile String filesError = null;

    private final List<Object[]> pending = new ArrayList<>();
    private boolean flushScheduled = false;

    WsBridge(Context ctx, WebView webView) {
        this.ctx = ctx;
        this.webView = webView;
        Thread t = new Thread(this::prepareFiles, "xq-prepare-engines");
        t.setDaemon(true);
        t.start();
    }

    // ---- chuẩn bị file engine ------------------------------------------------------------------
    private void prepareFiles() {
        try {
            File pikaDir = new File(ctx.getFilesDir(), "pikafish");
            File bfDir = new File(ctx.getFilesDir(), "bruteforce");
            if (!pikaDir.isDirectory() && !pikaDir.mkdirs()) throw new IOException("không tạo được " + pikaDir);
            if (!bfDir.isDirectory() && !bfDir.mkdirs()) throw new IOException("không tạo được " + bfDir);
            // NNUE ~44MB: chỉ chép lại khi khác kích thước (cập nhật APK có NNUE mới).
            File nnue = new File(pikaDir, "pikafish.nnue");
            long assetSize = assetLength(NNUE_ASSET);
            if (!nnue.isFile() || nnue.length() != assetSize) {
                File tmp = new File(pikaDir, "pikafish.nnue.tmp");
                try (InputStream in = ctx.getAssets().open(NNUE_ASSET); OutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                if (!tmp.renameTo(nnue)) throw new IOException("không đổi tên được file NNUE");
            }
        } catch (Exception e) {
            filesError = e.toString();
            Log.e(TAG, "chuẩn bị engine lỗi", e);
        } finally {
            filesReady.countDown();
        }
    }

    private long assetLength(String name) throws IOException {
        try (android.content.res.AssetFileDescriptor fd = ctx.getAssets().openFd(name)) {
            return fd.getLength();
        } catch (IOException e) {
            // Asset bị nén thì không openFd được; đọc hết để đếm.
            long total = 0;
            try (InputStream in = ctx.getAssets().open(name)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) total += n;
            }
            return total;
        }
    }

    /** CPU có lệnh dot-product (asimddp) thì dùng bản Pikafish nhanh hơn; không thì bản ARMv8 thường. */
    private static boolean cpuHasDotProd() {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/cpuinfo")))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("Features") && line.contains(" asimddp")) return true;
            }
        } catch (IOException ignored) { /* coi như không có */ }
        return false;
    }

    // ---- API gọi từ JS (chạy trên luồng JavaBridge, không phải luồng giao diện) -----------------
    @JavascriptInterface
    public void open(int id, String kind) {
        try { filesReady.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        final EngineSession.Output out = line -> emit(id, "message", line);
        File libs = new File(ctx.getApplicationInfo().nativeLibraryDir);
        EngineSession session;
        if (filesError != null) {
            session = null;
            Log.e(TAG, "bỏ qua open vì lỗi chuẩn bị file: " + filesError);
        } else if ("pikafish".equals(kind)) {
            File exe = new File(libs, cpuHasDotProd() ? "libpikafish_dp.so" : "libpikafish.so");
            session = new EngineSession("Pikafish", "PIKAFISH", exe, new File(ctx.getFilesDir(), "pikafish"), out);
        } else if ("bruteforce".equals(kind)) {
            session = new EngineSession("Brute-force", "BRUTEFORCE", new File(libs, "libbruteforce.so"),
                    new File(ctx.getFilesDir(), "bruteforce"), out);
        } else {
            session = null;
        }
        if (session != null) sessions.put(id, session);
        else emit(id, "message", "info string " + ("bruteforce".equals(kind) ? "BRUTEFORCE" : "PIKAFISH") + "_CRASHED unavailable");
    }

    @JavascriptInterface
    public void send(int id, String data) {
        EngineSession s = sessions.get(id);
        if (s == null || data == null) return;
        for (String line : data.split("\\r?\\n")) {
            String t = line.trim();
            if (!t.isEmpty()) s.sendToEngine(t);
        }
    }

    @JavascriptInterface
    public void close(int id) {
        EngineSession s = sessions.remove(id);
        if (s != null) s.forceStopEngine();
    }

    /** Trang tải lại/đóng: không để tiến trình engine nào chạy mồ côi. */
    void closeAll() {
        for (Integer id : new ArrayList<>(sessions.keySet())) close(id);
        synchronized (pending) { pending.clear(); }
    }

    // ---- đẩy dòng engine về trang, gom lô ~16ms để khỏi gọi evaluateJavascript cho từng dòng info ----
    private void emit(int id, String type, String data) {
        synchronized (pending) {
            pending.add(new Object[]{id, type, data});
            if (flushScheduled) return;
            flushScheduled = true;
        }
        main.postDelayed(this::flush, 16);
    }

    private void flush() {
        JSONArray batch = new JSONArray();
        synchronized (pending) {
            for (Object[] e : pending) {
                JSONArray item = new JSONArray();
                item.put(e[0]);
                item.put(e[1]);
                item.put(e[2]);
                batch.put(item);
            }
            pending.clear();
            flushScheduled = false;
        }
        if (batch.length() == 0) return;
        webView.evaluateJavascript("window.__xqWs&&window.__xqWs(" + batch + ")", null);
    }
}
