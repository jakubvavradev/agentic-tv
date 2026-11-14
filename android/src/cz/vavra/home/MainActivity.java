package cz.vavra.home;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home screen: a WebView over bundled assets (served as https://home.local/ so fonts/images share one origin). */
public class MainActivity extends Activity {
    private WebView web;

    private android.widget.FrameLayout root;
    private android.widget.ImageView wall;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        // 1) the wallpaper, natively and at once – also before the user storage is unlocked at boot (direct boot:
        //    assets live in the APK, so they are readable). This replaces the black FallbackHome screen.
        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        wall = new android.widget.ImageView(this);
        wall.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        try {
            String w = "wall/" + wallKey() + "-";
            Drawable bg = Drawable.createFromStream(getAssets().open(w + "bg.webp"), null), fg = Drawable.createFromStream(getAssets().open(w + "fg.webp"), null);
            wall.setImageDrawable(new android.graphics.drawable.LayerDrawable(new Drawable[]{bg, fg}));
        } catch (Exception ignored) {}
        root.addView(wall);
        setContentView(root);
        // 2) the WebView needs credential-encrypted storage, so it starts once the user is unlocked
        android.os.UserManager um = getSystemService(android.os.UserManager.class);
        if (um.isUserUnlocked()) startWeb();
        else {
            registerReceiver(new android.content.BroadcastReceiver() {
                @Override public void onReceive(android.content.Context c, Intent i) { unregisterReceiver(this); startWeb(); }
            }, new android.content.IntentFilter(Intent.ACTION_USER_UNLOCKED), android.content.Context.RECEIVER_EXPORTED);
            if (um.isUserUnlocked()) startWeb();
        }
    }

    /** Same choice as the page: month + time of day from the sun's elevation at the TV's location (saved by the page). */
    String wallKey() {
        android.content.SharedPreferences sp = createDeviceProtectedStorageContext().getSharedPreferences("loc", MODE_PRIVATE);
        double lat = sp.getFloat("lat", 50.08f), lon = sp.getFloat("lon", 14.42f);
        java.util.Calendar cal = java.util.Calendar.getInstance();
        double rad = Math.PI / 180, d = System.currentTimeMillis() / 864e5 - 10957.5, g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
        double L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
        double ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
        double H = ((18.697374558 + 24.06570982441908 * d) * 15 + lon) * rad - ra, p = lat * rad;
        double el = Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(H)) / rad;
        String slot = el < -4 ? "night" : el > 14 ? "day" : cal.get(java.util.Calendar.HOUR_OF_DAY) < 12 ? "sunrise" : "golden";
        return String.format(java.util.Locale.ROOT, "%02d-%s", cal.get(java.util.Calendar.MONTH) + 1, slot);
    }

    private boolean webStarted;
    private synchronized void startWeb() {
        if (webStarted) return;
        webStarted = true;
        runOnUiThread(this::initWeb);
    }

    private void initWeb() {
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);                      // native wallpaper shows through until the page paints
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setDomStorageEnabled(true);   // dock order lives in localStorage
        web.setFocusable(true);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                if (!"home.local".equals(r.getUrl().getHost())) return null;
                String path = r.getUrl().getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return null;
                if (path.startsWith("/banner/")) return banner(path.substring(8));
                try {
                    return new WebResourceResponse(mime(path), null, getAssets().open(path.substring(1)));
                } catch (Exception e) { return null; }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
        });
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage m) { android.util.Log.i("VavraHome", m.message()); return true; }
        });
        root.addView(web);
        web.loadUrl("https://home.local/index.html");
        web.requestFocus();
        web.onResume(); web.resumeTimers();
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".js")) return "text/javascript";
        return "application/octet-stream";
    }

    // Home pressed while we are already home: close the apps sheet, focus first app
    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (INSTALL.equals(i.getAction())) { installResult(i); return; }
        String say = i.getStringExtra("say");                            // test hook: am start ... --es say "pusť Wednesday na Netflixu"
        if (say != null) { voiceEvent("final", say); return; }
        js("window.onHome&&onHome()");
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {                // a launcher never exits on Back
            if (e.getAction() == KeyEvent.ACTION_UP) { if (listening) stopVoice(); js("window.onBack&&onBack()"); }
            return true;
        }
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_SEARCH || k == KeyEvent.KEYCODE_VOICE_ASSIST || k == KeyEvent.KEYCODE_ASSIST) {
            // the remote's mic button: never let the WebView swallow it, hand it straight to Google Assistant
            if (e.getAction() == KeyEvent.ACTION_UP) { if (listening) stopVoice(); else startVoice(); }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private final android.os.Handler shots = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable shot = new Runnable() { public void run() { if (front != null && !listening) KeyService.shoot(); shots.postDelayed(this, 60000); } };

    @Override protected void onResume() { super.onResume(); front = last = this; shots.removeCallbacks(shot); shots.postDelayed(shot, 2500); if (web == null) return; web.onResume(); web.resumeTimers(); js("window.onResumeHome&&onResumeHome()"); }
    @Override protected void onPause() { super.onPause(); front = null; shots.removeCallbacks(shot); leftAt = android.os.SystemClock.uptimeMillis(); if (listening) stopVoice(); if (web == null) return; web.onPause(); web.pauseTimers(); }   // zero CPU while an app is in front

    /* ---------- Czech voice commands: Google's recogniser (cs-CZ) turns speech into text, the page decides what to do ---------- */
    static volatile MainActivity front, last;                       // home screen while resumed / last instance (KeyService)
    static volatile long leftAt, assistantUntil;                     // when home lost focus; until when Google may stay open
    void startVoicePublic() { if (!listening) startVoice(); }
    private android.speech.SpeechRecognizer rec;
    private volatile String voiceLang = "cs-CZ";                    // set by the page from the chosen language
    private boolean listening;

    private void voiceEvent(String kind, String text) {
        js("window.onVoice&&onVoice(" + JSONObject.quote(kind) + "," + JSONObject.quote(text == null ? "" : text) + ")");
    }

    private void startVoice() {
        if (web == null || !android.speech.SpeechRecognizer.isRecognitionAvailable(this)
                || checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 7);
            startAssistant(); return;
        }
        if (rec == null) {
            rec = android.speech.SpeechRecognizer.createSpeechRecognizer(this);
            rec.setRecognitionListener(new android.speech.RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { voiceEvent("listen", ""); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float db) {}
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() { voiceEvent("thinking", ""); }
                @Override public void onError(int code) { listening = false; voiceEvent("error", String.valueOf(code)); }
                @Override public void onResults(Bundle b) { listening = false; voiceEvent("final", best(b)); }
                @Override public void onPartialResults(Bundle b) { voiceEvent("partial", best(b)); }
                @Override public void onEvent(int t, Bundle b) {}
            });
        }
        Intent i = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, voiceLang)
            .putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        listening = true;
        voiceEvent("start", "");
        rec.startListening(i);
    }

    private void stopVoice() { listening = false; if (rec != null) rec.cancel(); voiceEvent("cancel", ""); }

    private static String best(Bundle b) {
        java.util.ArrayList<String> r = b.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION);
        return r == null || r.isEmpty() ? "" : r.get(0);
    }

    private void startAssistant() {
        assistantUntil = android.os.SystemClock.uptimeMillis() + 15000;
        for (Intent i : new Intent[]{new Intent(Intent.ACTION_VOICE_COMMAND), new Intent(Intent.ACTION_ASSIST), new Intent("android.search.action.GLOBAL_SEARCH")}) {
            try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; } catch (Exception ignored) {}
        }
        onSearchRequested();
    }

    private void js(String s) { if (web != null) web.evaluateJavascript(s, null); }

    /* ---------- self-update from GitHub releases ---------- */
    static final String REPO = "jakubvavradev/agentic-tv", INSTALL = "cz.vavra.home.INSTALL_RESULT";
    private void status(String s) { runOnUiThread(() -> js("window.onUpdate&&onUpdate(" + JSONObject.quote(s) + ")")); }
    private void installResult(Intent i) {
        int st = i.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -999);
        if (st == android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) try { startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; } catch (Exception ignored) {}
            status("fail");
        } else status(st == android.content.pm.PackageInstaller.STATUS_SUCCESS ? "ok" : "fail");
    }

    /** App banner as a cached JPEG: drawn once per app version into cacheDir, then served straight from disk
     *  (the WebView loads them in parallel, nothing blocks the page). */
    private synchronized WebResourceResponse banner(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ResolveInfo ri;
            if (pkg.equals("com.android.tv.settings")) ri = pm.resolveActivity(new Intent(Settings.ACTION_SETTINGS), 0);
            else {
                List<ResolveInfo> l = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER).setPackage(pkg), 0);
                ri = l.isEmpty() ? null : l.get(0);
            }
            if (ri == null) return null;
            long ver = pm.getPackageInfo(pkg, 0).lastUpdateTime;
            java.io.File dir = new java.io.File(getCacheDir(), "banners"), f = new java.io.File(dir, pkg + "-" + ver + ".jpg");
            if (!f.exists()) {
                dir.mkdirs();
                Bitmap bm = Bitmap.createBitmap(400, 225, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(bm);
                c.drawColor(Color.rgb(28, 31, 38));
                Drawable d = ri.activityInfo.loadBanner(pm);
                if (d == null) d = ri.activityInfo.applicationInfo.loadBanner(pm);
                if (d != null) { d.setBounds(0, 0, 400, 225); d.draw(c); }
                else { Drawable ic = ri.loadIcon(pm); ic.setBounds(125, 37, 275, 187); ic.draw(c); }   // icon-only app
                java.io.File tmp = new java.io.File(dir, pkg + ".tmp");
                try (java.io.FileOutputStream o = new java.io.FileOutputStream(tmp)) { bm.compress(Bitmap.CompressFormat.JPEG, 92, o); }
                tmp.renameTo(f);
            }
            return new WebResourceResponse("image/jpeg", null, new java.io.FileInputStream(f));
        } catch (Exception e) { return null; }
    }

    class Bridge {
        @JavascriptInterface public String apps() {
            PackageManager pm = getPackageManager();
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(q, 0);
            // Settings has no leanback entry; add it so the apps grid reaches it
            Intent s = new Intent(Settings.ACTION_SETTINGS);
            ResolveInfo set = pm.resolveActivity(s, 0);
            if (set != null) list.add(set);
            JSONArray arr = new JSONArray();
            for (ResolveInfo ri : list) {
                try {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(getPackageName())) continue;
                    long ver = pm.getPackageInfo(pkg, 0).lastUpdateTime;   // only names here: banners load separately via /banner/
                    arr.put(new JSONObject().put("pkg", pkg).put("label", ri.loadLabel(pm).toString()).put("banner", "banner/" + pkg + "?v=" + ver));
                } catch (Exception ignored) {}
            }
            return arr.toString();
        }

        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "0"; }
        }

        @JavascriptInterface public void setLang(String tag) { if (tag != null && !tag.isEmpty()) voiceLang = tag; }

        /** The TV's location (from IP geolocation in the page); kept in device storage so the boot wallpaper can use it. */
        @JavascriptInterface public void setLoc(double lat, double lon) {
            createDeviceProtectedStorageContext().getSharedPreferences("loc", MODE_PRIVATE).edit().putFloat("lat", (float) lat).putFloat("lon", (float) lon).apply();
        }

        /** Download an update APK from a GitHub release and hand it to Android's package installer;
         *  the system asks the user to confirm (and, the first time, to allow installs from this app). */
        @JavascriptInterface public void install(final String url) {
            if (url == null || !url.startsWith("https://github.com/" + REPO + "/releases/download/")) { status("fail"); return; }
            new Thread(() -> {
                try {
                    status("downloading");
                    android.content.pm.PackageInstaller pi = getPackageManager().getPackageInstaller();
                    android.content.pm.PackageInstaller.SessionParams sp = new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                    sp.setAppPackageName(getPackageName());
                    int id = pi.createSession(sp);
                    try (android.content.pm.PackageInstaller.Session s = pi.openSession(id)) {
                        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                        c.setInstanceFollowRedirects(true); c.setConnectTimeout(15000); c.setReadTimeout(30000);
                        try (java.io.InputStream in = c.getInputStream(); java.io.OutputStream out = s.openWrite("update.apk", 0, -1)) {
                            byte[] buf = new byte[65536]; int n, last = -1; long got = 0, total = c.getContentLengthLong();
                            while ((n = in.read(buf)) > 0) {
                                out.write(buf, 0, n); got += n;
                                int pct = total > 0 ? (int) (got * 100 / total) : -1;
                                if (pct >= 0 && pct != last) { last = pct; final int p = pct; runOnUiThread(() -> js("window.onUpdateProgress&&onUpdateProgress(" + p + ")")); }
                            }
                            s.fsync(out);
                        }
                        Intent back = new Intent(MainActivity.this, MainActivity.class).setAction(INSTALL);
                        android.app.PendingIntent pend = android.app.PendingIntent.getActivity(MainActivity.this, 1, back,
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT | 0x02000000 /* FLAG_MUTABLE: the installer adds its result */);
                        s.commit(pend.getIntentSender());
                    }
                } catch (Exception e) { android.util.Log.w("AgenticTV", "update", e); status("fail"); }
            }).start();
        }

        /** The page has painted its final look: drop the native wallpaper (frees two decoded full-HD bitmaps). */
        @JavascriptInterface public void ready() {
            runOnUiThread(() -> { if (wall != null) { root.removeView(wall); wall.setImageDrawable(null); wall = null; } });
        }

        /** Hand a (usually English) command to Google Assistant, e.g. "play Wednesday on Netflix". */
        @JavascriptInterface public void assistant(final String query) {
            assistantUntil = android.os.SystemClock.uptimeMillis() + 15000;
            runOnUiThread(() -> {
                if (KeyService.typeCommand(query)) return;              // typed into the Assistant = runs as a command
                try { startActivity(new Intent("com.google.android.googlequicksearchbox.GOOGLE_SEARCH").putExtra("query", query).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception e) { try { startActivity(new Intent("android.search.action.GLOBAL_SEARCH").putExtra("query", query).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {} }
            });
        }

        /** Open a link inside a given app (deep link); falls back to just starting the app. */
        @JavascriptInterface public void openIn(final String pkg, final String url) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(i); } catch (Exception e) { new Bridge().launch(pkg); }
            });
        }

        @JavascriptInterface public void listen() { runOnUiThread(() -> { if (!listening) startVoice(); }); }

        @JavascriptInterface public void launch(final String pkg) {
            runOnUiThread(() -> {
                PackageManager pm = getPackageManager();
                Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
                if (i == null) i = pm.getLaunchIntentForPackage(pkg);
                if (i == null && pkg.equals("com.android.tv.settings")) i = new Intent(Settings.ACTION_SETTINGS);
                if (i == null) return;
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(i); } catch (Exception ignored) {}
            });
        }
    }
}
