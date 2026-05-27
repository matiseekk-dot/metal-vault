package pl.skudev.metalvault;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — extends Capacitor's BridgeActivity with native WebView
 * tweaks that the JSON config layer can't express:
 *
 *  1. Disable pinch-zoom on the WebView. The PWA viewport meta tag
 *     allows pinch-zoom (WCAG accessibility — required for Play Store
 *     listing review), but inside the native wrapper that gesture
 *     caused the Calendar tab to zoom-out and lose the bottom nav. In
 *     a native app, content-zoom isn't expected — pinch-zoom should
 *     no-op. We turn it off ONLY in the WebView; the actual website
 *     served on the open web keeps its WCAG-compliant zoomability.
 *
 *  2. Grant WebView notification + media permissions automatically.
 *     Android WebView denies these by default unless WebChromeClient
 *     overrides onPermissionRequest. Without the override, calling
 *     Notification.requestPermission() silently resolves to "denied"
 *     and Web Push subscribe fails — user clicks "Enable notifications"
 *     and nothing happens. Granting the JS-level permission here lets
 *     the in-app prompt + Android system POST_NOTIFICATIONS permission
 *     (declared in the manifest) flow do the actual user gate.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();

        // (1) Disable pinch-zoom — Calendar tab fix.
        settings.setBuiltInZoomControls(false);
        settings.setSupportZoom(false);
        settings.setDisplayZoomControls(false);

        // (2) Grant WebChromeClient permissions (notifications, camera,
        //     geolocation when JS requests them). We grant whatever the
        //     page asks for here, then defer to the system-level permission
        //     prompt declared in AndroidManifest (POST_NOTIFICATIONS,
        //     CAMERA) for the actual user-facing approval.
        WebChromeClient existing = new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        };
        webView.setWebChromeClient(existing);
    }
}
