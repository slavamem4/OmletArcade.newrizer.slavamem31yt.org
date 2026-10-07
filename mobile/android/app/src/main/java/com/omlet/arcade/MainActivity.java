package com.omlet.arcade;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Thin Android shell around the web app.
 *
 * The app itself is served by the backend (same origin as the API), so the APK
 * contains no secrets and no duplicated code: this activity provides the
 * WebView, WebRTC permission plumbing, autoplay unlock and the system Back
 * mapping. Everything else lives in web/.
 */
public class MainActivity extends Activity {

    private static final int PERMISSION_REQUEST_CODE = 41;
    private static final String[] MEDIA_PERMISSIONS = {
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
    };

    private WebView webView;
    private PermissionRequest pendingRequest;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor("#0B1117"));
        getWindow().setNavigationBarColor(Color.parseColor("#0B1117"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0B1117"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Voice rooms must be able to start remote audio without a tap.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setDatabaseEnabled(true);

        webView.setWebChromeClient(new MediaChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showOffline();
            }
        });

        webView.loadUrl(getString(R.string.server_url));
    }

    /** Grants WebRTC capture requests once the Android permissions are in. */
    private class MediaChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            boolean needsAndroidPermission = false;
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    needsAndroidPermission = true;
                }
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                        && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    needsAndroidPermission = true;
                }
            }
            if (!needsAndroidPermission) {
                request.grant(request.getResources());
                return;
            }
            pendingRequest = request;
            requestPermissions(MEDIA_PERMISSIONS, PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != PERMISSION_REQUEST_CODE || pendingRequest == null) return;
        if (hasMediaPermissions()) {
            pendingRequest.grant(pendingRequest.getResources());
        } else {
            pendingRequest.deny();
        }
        pendingRequest = null;
    }

    private boolean hasMediaPermissions() {
        for (String permission : MEDIA_PERMISSIONS) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    /** System Back steps through the WebView history before leaving the app. */
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void showOffline() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(64, 128, 64, 64);
        box.setBackgroundColor(Color.parseColor("#0B1117"));

        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(Color.parseColor("#E6EDF3"));
        title.setTextSize(20);

        TextView body = new TextView(this);
        body.setText(R.string.offline_body);
        body.setTextColor(Color.parseColor("#9AA7B4"));
        body.setPadding(0, 16, 0, 48);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                setContentView(webView);
                webView.loadUrl(getString(R.string.server_url));
            }
        });

        box.addView(title);
        box.addView(body);
        box.addView(retry);
        setContentView(box);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
