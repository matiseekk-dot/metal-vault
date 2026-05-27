package pl.skudev.metalvault;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — extends Capacitor's BridgeActivity with WebView setting
 * tweaks the JSON config layer can't express.
 *
 * Earlier revisions replaced the WebChromeClient outright to grant
 * notification permissions. That removed Capacitor's own bridge
 * handlers (file pickers, fullscreen video, JS console forwarding,
 * permission delegate for camera) and didn't actually fix push —
 * Android WebView's Notification API is fundamentally limited
 * regardless of WebChromeClient overrides. The proper notification
 * fix is the @capacitor/push-notifications plugin with Firebase Cloud
 * Messaging, planned for v1.1. The mobile app now surfaces a clear
 * "use the web version" prompt instead of letting the user tap a
 * dead button.
 *
 * What we still do here: disable pinch-zoom in the WebView. The PWA
 * viewport meta allows pinch-zoom (WCAG / Play Store accessibility
 * review needs it), but in the native wrapper the gesture fires
 * accidentally on dense grids (Calendar tab) and zooms the page
 * out, hiding the bottom nav. Native apps don't expect content-zoom,
 * so disabling it is the correct UX. Open-web PWA keeps zoom.
 *
 * NOTE: the heavy lifting for pinch-zoom is now ALSO done at the JS
 * layer in app/layout.js (Capacitor-only viewport patch + touchmove
 * preventDefault). Native WebSettings here are a belt-and-braces
 * second line of defence because Chrome WebView honors the meta tag
 * inconsistently across Android versions / device manufacturers.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();

        settings.setBuiltInZoomControls(false);
        settings.setSupportZoom(false);
        settings.setDisplayZoomControls(false);
    }
}
