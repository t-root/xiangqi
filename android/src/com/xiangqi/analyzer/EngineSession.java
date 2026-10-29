package com.xiangqi.analyzer;

import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Một "phiên" = một tiến trình engine UCI riêng gắn với đúng một kết nối WebSocket giả của trang.
 * Đây là bản port của createSession() trong engine/server.js (cầu nối Node trên PC): cùng cách
 * xếp hàng lệnh trong lúc đang tìm kiếm, cùng cách dừng/khởi động lại, cùng dòng báo crash
 * "info string <TAG>_CRASHED" mà trang dò để biết engine vừa chết.
 */
final class EngineSession {
    interface Output { void line(String line); }

    private static final String TAG = "XQEngine";
    private static final Pattern SEARCH_CMD = Pattern.compile("^search\\s+(?:slice|resume)(?:\\s.*)?$");
    private static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "xq-engine-restart");
        t.setDaemon(true);
        return t;
    });

    private final String label;
    private final String crashTag;
    private final File exe;
    private final File dir;
    private final Output out;

    private Process engine;
    private OutputStream stdin;
    private boolean searchInFlight;
    private boolean restartRequested;
    private boolean shutdownRequested;
    private boolean stopSent;
    private boolean restartPending;
    private final ArrayDeque<String> queuedCommands = new ArrayDeque<>();
    private final ArrayDeque<String> afterSearch = new ArrayDeque<>();

    EngineSession(String label, String crashTag, File exe, File dir, Output out) {
        this.label = label;
        this.crashTag = crashTag;
        this.exe = exe;
        this.dir = dir;
        this.out = out;
        synchronized (this) { startEngine(); }
    }

    // Gọi khi đã giữ khoá this.
    private void startEngine() {
        Log.i(TAG, "[" + label + "] khởi động: " + exe);
        final Process child;
        try {
            child = new ProcessBuilder(exe.getAbsolutePath()).directory(dir).start();
        } catch (IOException e) {
            engine = null;
            stdin = null;
            restartRequested = false;
            out.line("info string " + crashTag + "_CRASHED spawn " + e.getMessage());
            Log.e(TAG, "[" + label + "] không chạy được engine", e);
            return;
        }
        engine = child;
        stdin = child.getOutputStream();
        restartRequested = false;
        shutdownRequested = false;

        Thread reader = new Thread(() -> readLoop(child), "xq-" + label + "-out");
        reader.setDaemon(true);
        reader.start();
        Thread errReader = new Thread(() -> drainStderr(child), "xq-" + label + "-err");
        errReader.setDaemon(true);
        errReader.start();
    }

    private void readLoop(Process child) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isEmpty()) continue;
                boolean best = line.startsWith("bestmove");
                synchronized (this) {
                    if (engine != child || shutdownRequested) continue;
                    if (best) { searchInFlight = false; stopSent = false; }
                }
                out.line(line);
                if (best) {
                    String[] pending;
                    synchronized (this) {
                        pending = afterSearch.toArray(new String[0]);
                        afterSearch.clear();
                    }
                    for (String command : pending) sendToEngine(command);
                }
            }
        } catch (IOException ignored) {
            // tiến trình đã bị kill: xử lý ở onEngineFailure bên dưới
        }
        int code = -1;
        try { code = child.waitFor(); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        onEngineFailure(child, code);
    }

    private void drainStderr(Process child) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(child.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) Log.w(TAG, "[" + label + " stderr] " + line);
        } catch (IOException ignored) { /* đóng cùng tiến trình */ }
    }

    private void onEngineFailure(Process child, int code) {
        synchronized (this) {
            // Đã có lượt mới thay thế thì sự kiện thoát của tiến trình cũ không được đụng tới trạng thái.
            if (engine != child) return;
            boolean wasRequested = shutdownRequested;
            Log.e(TAG, "[" + label + "] đã thoát (code=" + code + ")" + (wasRequested ? " — dừng theo yêu cầu." : " — khởi động lại sau 1 giây."));
            searchInFlight = false;
            afterSearch.clear();
            stopSent = false;
            engine = null;
            stdin = null;
            if (wasRequested) {
                restartRequested = false;
                queuedCommands.clear();
                return;
            }
            restartRequested = true;
        }
        out.line("info string " + crashTag + "_CRASHED code=" + code);
        out.line("info string " + label + " process exited, restarting...");
        synchronized (this) {
            if (restartPending) return;
            restartPending = true;
        }
        TIMER.schedule(() -> {
            synchronized (this) {
                restartPending = false;
                if (shutdownRequested || !restartRequested) return;
                startEngine();
                while (!queuedCommands.isEmpty() && engine != null) writeLocked(queuedCommands.poll());
            }
        }, 1, TimeUnit.SECONDS);
    }

    /** Dừng hẳn engine của phiên này (không còn tiến trình chạy ngầm). Giống forceStopEngine() trong server.js. */
    void forceStopEngine() {
        Process current;
        boolean wasSearching;
        synchronized (this) {
            current = engine;
            shutdownRequested = true;
            restartRequested = false;
            queuedCommands.clear();
            afterSearch.clear();
            stopSent = false;
            wasSearching = searchInFlight;
            if (current == null) return;
            searchInFlight = false;
        }
        if (wasSearching) out.line("info string " + crashTag + "_CRASHED");
        Log.i(TAG, "[" + label + "] dừng hẳn engine của phiên này.");
        current.destroy();
    }

    void sendToEngine(String line) {
        if (line.trim().equals("__force_shutdown__")) {
            forceStopEngine();
            return;
        }
        synchronized (this) {
            if (engine == null || !engine.isAlive()) {
                if (shutdownRequested) {
                    startEngine();
                    if (engine == null) return;
                } else if (restartRequested) {
                    queuedCommands.add(line);
                    return;
                } else {
                    Log.w(TAG, "[" + label + "] chưa sẵn sàng, bỏ qua lệnh: " + line);
                    return;
                }
            }
            boolean startsSearch = line.equals("go") || line.startsWith("go ") || SEARCH_CMD.matcher(line).matches();
            if (searchInFlight && !line.equals("stop") && !line.equals("quit")) {
                // "position"/"setoption" đang dùng lại trạng thái của luồng tìm kiếm; phải đợi nó dừng hẳn.
                afterSearch.add(line);
                if (!stopSent) { writeLocked("stop"); stopSent = true; }
                return;
            }
            if (line.equals("stop")) stopSent = true;
            if (startsSearch) searchInFlight = true;
            writeLocked(line);
        }
    }

    // Gọi khi đã giữ khoá this.
    private void writeLocked(String line) {
        final Process child = engine;
        if (child == null || stdin == null) return;
        try {
            stdin.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            stdin.flush();
        } catch (IOException e) {
            Log.w(TAG, "[" + label + "] ghi stdin lỗi: " + e.getMessage());
            child.destroy(); // vòng đọc sẽ thấy EOF và chạy onEngineFailure
        }
    }
}
