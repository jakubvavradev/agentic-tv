package cz.vavra.home;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Display;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.ImageView;

/** Two jobs, both only around Google Assistant (katniss):
 *  1) The remote's mic key always opens Google Assistant (the system consumes it). Over the home screen we hide that:
 *     a snapshot of the home screen covers the display the moment Google's window appears, Google is closed underneath,
 *     and the home screen's Czech voice starts. Inside other apps nothing changes.
 *  2) "play Wednesday on Netflix" only works when *typed into* the Assistant (an intent just searches). So for a command
 *     the home screen opens the Assistant, switches it to typing, fills the text in and presses Enter. */
public class KeyService extends AccessibilityService {
    static final String GOOGLE = "com.google.android.katniss";
    static volatile KeyService self;
    private final Handler h = new Handler(Looper.getMainLooper());
    private Bitmap snap;
    private ImageView cover;
    private volatile String pending;                                     // command waiting to be typed into the Assistant
    private long pendingAt;
    private boolean kbdClicked;
    private long quietUntil;                                             // Google's own closing events after a takeover

    @Override protected void onServiceConnected() { self = this; }
    @Override public boolean onUnbind(Intent i) { self = null; return super.onUnbind(i); }

    /** Snapshot of the home screen, used as the cover (taken while the home screen is idle in front). */
    static void shoot() {
        KeyService s = self;
        if (s == null || android.os.Build.VERSION.SDK_INT < 30) return;
        s.takeScreenshot(Display.DEFAULT_DISPLAY, s.getMainExecutor(), new TakeScreenshotCallback() {
            @Override public void onSuccess(ScreenshotResult r) {
                Bitmap b = Bitmap.wrapHardwareBuffer(r.getHardwareBuffer(), r.getColorSpace());
                if (b != null) s.snap = b;
            }
            @Override public void onFailure(int code) {}
        });
    }

    /** Type a command into Google Assistant and send it. Returns false if the service is not running. */
    static boolean typeCommand(String text) {
        KeyService s = self;
        if (s == null) return false;
        s.pending = text; s.pendingAt = SystemClock.uptimeMillis(); s.kbdClicked = false;
        MainActivity.assistantUntil = SystemClock.uptimeMillis() + 20000;
        try { s.startActivity(new Intent(Intent.ACTION_ASSIST).setPackage(GOOGLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { s.pending = null; return false; }
        s.h.postDelayed(() -> s.tryType(), 700);
        s.h.postDelayed(() -> s.tryType(), 1500);
        return true;
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getPackageName() == null || !GOOGLE.contentEquals(e.getPackageName())) return;
        if (pending != null) { tryType(); return; }
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        long now = SystemClock.uptimeMillis();
        boolean onHome = MainActivity.front != null || now - MainActivity.leftAt < 1200;
        if (!onHome || now < MainActivity.assistantUntil || now < quietUntil) return;   // elsewhere, on purpose, or just taken over
        quietUntil = now + 2500;
        showCover();
        performGlobalAction(GLOBAL_ACTION_BACK);                         // close Google's panel under the cover
        h.postDelayed(() -> {
            MainActivity m = MainActivity.front != null ? MainActivity.front : MainActivity.last;
            if (m != null) m.startVoicePublic();
        }, 250);
        h.postDelayed(this::hideCover, 650);
    }

    private void showCover() {
        if (snap == null || cover != null) return;
        cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.FIT_XY);
        cover.setImageBitmap(snap);
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.OPAQUE);
        try { getSystemService(WindowManager.class).addView(cover, p); } catch (Exception ex) { cover = null; }
    }

    private void hideCover() {
        if (cover == null) return;
        try { getSystemService(WindowManager.class).removeView(cover); } catch (Exception ignored) {}
        cover = null;
    }

    private void tryType() {
        String text = pending;
        if (text == null) return;
        if (SystemClock.uptimeMillis() - pendingAt > 9000) { pending = null; return; }
        for (AccessibilityWindowInfo w : getWindows()) {
            AccessibilityNodeInfo root = w.getRoot();
            if (root == null || root.getPackageName() == null || !GOOGLE.contentEquals(root.getPackageName())) continue;
            AccessibilityNodeInfo edit = find(root, true);
            if (edit != null) {
                Bundle a = new Bundle();
                a.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
                edit.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, a);
                edit.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
                pending = null;
                return;
            }
            if (!kbdClicked) {
                AccessibilityNodeInfo kbd = find(root, false);
                while (kbd != null && !kbd.isClickable()) kbd = kbd.getParent();
                if (kbd != null) { kbdClicked = kbd.performAction(AccessibilityNodeInfo.ACTION_CLICK); h.postDelayed(this::tryType, 500); }
            }
        }
    }

    /** edit=true: the text field; edit=false: the "typing mode" (keyboard) button. */
    private static AccessibilityNodeInfo find(AccessibilityNodeInfo n, boolean edit) {
        if (n == null) return null;
        if (edit) { if (n.isEditable() || "android.widget.EditText".contentEquals(String.valueOf(n.getClassName()))) return n; }
        else {
            CharSequence d = n.getContentDescription();
            if (d != null) { String s = d.toString().toLowerCase(); if (s.contains("psaní") || s.contains("typing") || s.contains("keyboard") || s.contains("klávesnic")) return n; }
        }
        for (int i = 0; i < n.getChildCount(); i++) { AccessibilityNodeInfo r = find(n.getChild(i), edit); if (r != null) return r; }
        return null;
    }

    @Override public void onInterrupt() {}
}
