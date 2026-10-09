package com.xiangqi.analyzer;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Vỏ APK: một WebView mở xiangqi-analyzer.html lấy từ assets (qua địa chỉ https giả
 * appassets.xiangqi.local), cộng cầu nối engine native (WsBridge). Không cần mạng, không cần PC.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.xiangqi.local";
    private static final String ASSET_ROOT = "www";
    private static final int REQ_FILE = 1001;

    private WebView webView;
    private WsBridge bridge;
    private String shimJs = "";
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Phân tích dài (♾️) mà màn hình tắt là engine bị hệ thống làm chậm/ngủ — giữ sáng khi app đang mở.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        try { shimJs = readAssetText("xq-ws-shim.js"); } catch (IOException ignored) { /* thiếu shim: engine sẽ không nối được */ }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);
        WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect khi cần gỡ lỗi

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        bridge = new WsBridge(getApplicationContext(), webView);
        webView.addJavascriptInterface(bridge, "XQBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                // Trang tải lại: các "kết nối" cũ không còn ai nghe, dừng engine của chúng.
                bridge.closeAll();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return null;
                return serveAsset(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { /* không có app mở */ }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // WebView chết (hết RAM...): nạp lại thay vì để app đứng.
                bridge.closeAll();
                view.loadUrl("https://" + HOST + "/xiangqi-analyzer.html");
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    String[] accept = params.getAcceptTypes();
                    if (accept != null && accept.length > 0 && accept[0] != null && !accept[0].isEmpty()) {
                        intent.putExtra(Intent.EXTRA_MIME_TYPES, accept);
                    }
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(Intent.createChooser(intent, "Chọn tệp"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("XQPage", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl("https://" + HOST + "/xiangqi-analyzer.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE) { super.onActivityResult(requestCode, resultCode, data); return; }
        ValueCallback<Uri[]> cb = pendingFileCallback;
        pendingFileCallback = null;
        if (cb == null) return;
        cb.onReceiveValue(resultCode == RESULT_OK && data != null
                ? parseFileResult(data) : null);
    }

    private static Uri[] parseFileResult(Intent data) {
        if (data.getClipData() != null) {
            Uri[] uris = new Uri[data.getClipData().getItemCount()];
            for (int i = 0; i < uris.length; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            return uris;
        }
        return data.getData() != null ? new Uri[]{data.getData()} : null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.closeAll();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    // ---- phục vụ file trong assets/www như một website ---------------------------------------------
    private WebResourceResponse serveAsset(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.equals("/") || path.isEmpty()) path = "/xiangqi-analyzer.html";
        if (path.contains("..")) return notFound();
        String rel = path.substring(1);
        try {
            if (rel.equals("coi-serviceworker.js")) {
                // Service worker bat isolation cho engine Web: APK khong dung engine Web nen tra script rong.
                return response("text/javascript", new ByteArrayInputStream(new byte[0]));
            }
            if (rel.equals("xiangqi-analyzer.html")) {
                String html = readAssetText(ASSET_ROOT + "/" + rel);
                html = html.replace("<script src=\"coi-serviceworker.js\"></script>", "");
                int head = html.indexOf("<head>");
                String inject = "<script>" + shimJs + "</script>";
                html = head >= 0 ? html.substring(0, head + 6) + inject + html.substring(head + 6) : inject + html;
                return response("text/html", new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
            }
            InputStream in = getAssets().open(ASSET_ROOT + "/" + rel);
            return response(mimeFor(rel), in);
        } catch (java.io.FileNotFoundException e) {
            android.util.Log.w("XQAssets", "khong co asset: " + rel);
            if (!rel.endsWith(".html")) return notFound();
            String listing;
            try {
                listing = "assets/: " + java.util.Arrays.toString(getAssets().list(""))
                        + "\nassets/www/: " + java.util.Arrays.toString(getAssets().list(ASSET_ROOT));
            } catch (IOException ex) { listing = "(khong liet ke duoc: " + ex + ")"; }
            String page = "<meta charset=utf-8><pre style='white-space:pre-wrap;font:14px monospace'>Khong tim thay asset: "
                    + ASSET_ROOT + "/" + rel + "\n\n" + e + "\n\n" + listing + "</pre>";
            return response("text/html", new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8)));
        } catch (Throwable e) {
            // Loi that su khi doc/chen asset: hien thang tren man hinh de biet nguyen nhan thay vi trang trang.
            android.util.Log.e("XQAssets", "loi phuc vu " + rel, e);
            if (!rel.endsWith(".html")) return notFound();
            java.io.StringWriter sw = new java.io.StringWriter();
            e.printStackTrace(new java.io.PrintWriter(sw));
            String page = "<meta charset=utf-8><pre style='white-space:pre-wrap;font:14px monospace'>Loi nap " + rel + "\n\n"
                    + sw.toString().replace("&", "&amp;").replace("<", "&lt;") + "</pre>";
            return response("text/html", new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8)));
        }
    }

    private static WebResourceResponse response(String mime, InputStream body) {
        WebResourceResponse r = new WebResourceResponse(mime, "UTF-8".equals(charsetFor(mime)) ? "UTF-8" : null, body);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        r.setResponseHeaders(headers);
        return r;
    }

    private static String charsetFor(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") ? "UTF-8" : "";
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<String, String>(),
                new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeFor(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".wasm")) return "application/wasm";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private String readAssetText(String name) throws IOException {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(1 << 20);
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
