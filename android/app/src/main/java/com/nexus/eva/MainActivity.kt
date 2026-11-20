package com.nexus.eva

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import org.json.JSONObject

/**
 * Single-Activity host for Nexus Eva Android APK.
 * Features:
 * - Edge-to-edge hardware-accelerated WebView with window.NexusAndroid JS bridge
 * - Runtime Android Mic, Camera & Notification permission requests + WebView media auto-grant
 * - Predictive / Hardware Back gesture routed to window.__nexusAndroidHandleBack()
 * - Saved Server URL picker with quick Cloud/LAN/USB connect + offline recovery view
 * - Android 14+ Foreground Microphone Voice Service sync
 */
class MainActivity : AppCompatActivity() {

    private lateinit var serverPrefs: ServerPrefs
    private lateinit var webView: WebView
    private lateinit var loadingBar: ProgressBar
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorDetailText: TextView

    private var pendingWebPermission: PermissionRequest? = null
    private var pendingVoiceStatusAfterPerm: String? = null
    private var pendingWakeArmAfterPerm: Pair<String, String?>? = null
    private var lastBackExitPromptMs: Long = 0L
    private var webViewPageReady: Boolean = false
    private var pendingWakePayloadJson: String? = null
    private var lastDeliveredWakeTimestampMs: Long = 0L

    private val mediaPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val request = pendingWebPermission
            pendingWebPermission = null
            if (request != null) {
                val grantResources = mutableListOf<String>()
                request.resources.forEach { res ->
                    when (res) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                            if (results[Manifest.permission.RECORD_AUDIO] == true || hasPermission(Manifest.permission.RECORD_AUDIO)) {
                                grantResources.add(res)
                            }
                        }
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                            if (results[Manifest.permission.CAMERA] == true || hasPermission(Manifest.permission.CAMERA)) {
                                grantResources.add(res)
                            }
                        }
                        else -> grantResources.add(res)
                    }
                }
                if (grantResources.isNotEmpty()) {
                    request.grant(grantResources.toTypedArray())
                } else {
                    request.deny()
                }
            }

            val voiceStatus = pendingVoiceStatusAfterPerm
            pendingVoiceStatusAfterPerm = null
            if (voiceStatus != null && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                EvaVoiceForegroundService.start(this, voiceStatus)
            }

            val wakeArm = pendingWakeArmAfterPerm
            pendingWakeArmAfterPerm = null
            if (wakeArm != null && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                EvaVoiceForegroundService.armWakeListener(this, wakeArm.first, wakeArm.second)
            }
        }

    private val serviceEventsReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                EvaVoiceForegroundService.BROADCAST_VOICE_STOPPED -> {
                    webView.evaluateJavascript(
                        "window.__nexusAndroidStopVoice && window.__nexusAndroidStopVoice();",
                        null
                    )
                }
                EvaVoiceForegroundService.BROADCAST_WAKE_DETECTED -> {
                    handleNativeWakeIntent(intent)
                }
                EvaVoiceForegroundService.BROADCAST_STATE_CHANGED -> {
                    val stateJson = intent.getStringExtra(EvaVoiceForegroundService.EXTRA_STATE_JSON)
                        ?: EvaVoiceForegroundService.currentSnapshot.toJson().toString()
                    dispatchServiceStateToWeb(stateJson)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        serverPrefs = ServerPrefs(this)
        buildLayout()
        configureWebView()
        applySystemBarsTheme(isDark = true)
        registerBackGestureHandler()

        val filter = IntentFilter().apply {
            addAction(EvaVoiceForegroundService.BROADCAST_VOICE_STOPPED)
            addAction(EvaVoiceForegroundService.BROADCAST_WAKE_DETECTED)
            addAction(EvaVoiceForegroundService.BROADCAST_STATE_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(serviceEventsReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(serviceEventsReceiver, filter)
        }

        if (intent?.action == EvaVoiceForegroundService.ACTION_WAKE_BRING_FRONT) {
            handleNativeWakeIntent(intent)
        }

        val activeUrl = serverPrefs.getActiveUrl()
        if (activeUrl.isNullOrBlank()) {
            showServerPicker(cancelable = false)
        } else {
            loadServerUrl(activeUrl)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == EvaVoiceForegroundService.ACTION_WAKE_BRING_FRONT) {
            handleNativeWakeIntent(intent)
        }
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(serviceEventsReceiver) }
        pendingWebPermission?.deny()
        pendingWebPermission = null
        webView.destroy()
        super.onDestroy()
    }

    private fun buildLayout() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.nexus_bg_dark))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.TRANSPARENT)
        }
        root.addView(webView)

        loadingBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP
            )
        }
        root.addView(loadingBar)

        // Native offline / unreachable recovery view
        errorOverlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            setBackgroundColor(ContextCompat.getColor(context, R.color.nexus_bg_dark))
            setPadding(dp(28), dp(28), dp(28), dp(28))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val offlineTitle = TextView(this).apply {
            text = getString(R.string.offline_title)
            setTextColor(ContextCompat.getColor(context, R.color.nexus_on_surface_dark))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        errorDetailText = TextView(this).apply {
            text = getString(R.string.offline_subtitle)
            setTextColor(ContextCompat.getColor(context, R.color.nexus_on_surface_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(22))
        }

        val retryBtn = MaterialButton(this).apply {
            text = getString(R.string.btn_retry)
            layoutParams = LinearLayout.LayoutParams(dp(220), dp(48)).apply {
                bottomMargin = dp(10)
            }
            setOnClickListener {
                errorOverlay.visibility = View.GONE
                val current = serverPrefs.getActiveUrl()
                if (current != null) loadServerUrl(current) else showServerPicker(cancelable = false)
            }
        }

        val switchBtn = MaterialButton(
            this,
            null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle
        ).apply {
            text = getString(R.string.btn_switch_server)
            layoutParams = LinearLayout.LayoutParams(dp(220), dp(48))
            setOnClickListener { showServerPicker(cancelable = true) }
        }

        errorOverlay.addView(offlineTitle)
        errorOverlay.addView(errorDetailText)
        errorOverlay.addView(retryBtn)
        errorOverlay.addView(switchBtn)
        root.addView(errorOverlay)

        // Apply system bar insets cleanly while preserving edge-to-edge feel
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        setContentView(root)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString NexusEvaAndroid/${BuildConfig.VERSION_NAME}"
        }

        webView.addJavascriptInterface(EvaJsBridge(this, serverPrefs), "NexusAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                webViewPageReady = true
                loadingBar.visibility = View.GONE
                errorOverlay.visibility = View.GONE
                dispatchServiceStateToWeb(EvaVoiceForegroundService.currentSnapshot.toJson().toString())
                pendingWakePayloadJson?.let { queued ->
                    pendingWakePayloadJson = null
                    dispatchWakeToWeb(queued)
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame == true) {
                    loadingBar.visibility = View.GONE
                    errorDetailText.text = "${error?.description ?: getString(R.string.offline_subtitle)}\n(${request.url})"
                    errorOverlay.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                runOnUiThread { handleWebPermissionRequest(request) }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean = true
        }
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val neededAndroidPerms = mutableListOf<String>()
        request.resources.forEach { res ->
            when (res) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                    if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
                        neededAndroidPerms.add(Manifest.permission.RECORD_AUDIO)
                    }
                }
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                    if (!hasPermission(Manifest.permission.CAMERA)) {
                        neededAndroidPerms.add(Manifest.permission.CAMERA)
                    }
                }
            }
        }

        if (neededAndroidPerms.isEmpty()) {
            request.grant(request.resources)
        } else {
            pendingWebPermission?.deny()
            pendingWebPermission = request
            mediaPermissionLauncher.launch(neededAndroidPerms.toTypedArray())
        }
    }

    fun startForegroundVoice(statusText: String) {
        val needed = mutableListOf<String>()
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (needed.isEmpty()) {
            EvaVoiceForegroundService.start(this, statusText)
        } else {
            pendingVoiceStatusAfterPerm = statusText
            mediaPermissionLauncher.launch(needed.toTypedArray())
        }
    }

    fun stopForegroundVoice() {
        EvaVoiceForegroundService.stop(this)
    }

    fun startNativeWakeListener(wakePhrase: String, serverUrl: String?) {
        val needed = mutableListOf<String>()
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (needed.isEmpty()) {
            EvaVoiceForegroundService.armWakeListener(this, wakePhrase, serverUrl)
        } else {
            pendingWakeArmAfterPerm = wakePhrase to serverUrl
            mediaPermissionLauncher.launch(needed.toTypedArray())
        }
    }

    fun pauseNativeWakeListener(statusText: String) {
        if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            EvaVoiceForegroundService.pauseWakeForLiveVoice(this, statusText)
        }
    }

    private fun handleNativeWakeIntent(intent: Intent) {
        val ts = intent.getLongExtra(EvaVoiceForegroundService.EXTRA_WAKE_TIMESTAMP, System.currentTimeMillis())
        if (ts == lastDeliveredWakeTimestampMs) return
        lastDeliveredWakeTimestampMs = ts

        val payload = JSONObject().apply {
            put("matchedPhrase", intent.getStringExtra(EvaVoiceForegroundService.EXTRA_MATCHED_PHRASE) ?: WakePhraseMatcher.DEFAULT_WAKE_PHRASE)
            put("trailingCommand", intent.getStringExtra(EvaVoiceForegroundService.EXTRA_TRAILING_COMMAND) ?: "")
            put("transcript", intent.getStringExtra(EvaVoiceForegroundService.EXTRA_TRANSCRIPT) ?: "")
            put("timestamp", ts)
            put("source", "android-foreground-service")
        }.toString()

        if (webViewPageReady) {
            dispatchWakeToWeb(payload)
        } else {
            pendingWakePayloadJson = payload
        }
    }

    private fun dispatchWakeToWeb(payloadJson: String) {
        val quoted = JSONObject.quote(payloadJson)
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__nexusAndroidOnWakeDetected && window.__nexusAndroidOnWakeDetected($quoted);",
                null
            )
        }
    }

    private fun dispatchServiceStateToWeb(stateJson: String) {
        if (!webViewPageReady) return
        val quoted = JSONObject.quote(stateJson)
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__nexusAndroidOnServiceState && window.__nexusAndroidOnServiceState($quoted);",
                null
            )
        }
    }

    fun showServerPicker(cancelable: Boolean) {
        ServerSetupDialog(
            context = this,
            serverPrefs = serverPrefs,
            scope = lifecycleScope,
            cancelable = cancelable,
            onConnect = { url -> loadServerUrl(url) }
        ).show()
    }

    fun applySystemBarsTheme(isDark: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDark
        controller.isAppearanceLightNavigationBars = !isDark
    }

    private fun loadServerUrl(url: String) {
        webViewPageReady = false
        errorOverlay.visibility = View.GONE
        loadingBar.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun registerBackGestureHandler() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (errorOverlay.visibility == View.VISIBLE) {
                        promptDoubleBackExit()
                        return
                    }
                    webView.evaluateJavascript(
                        "(function(){ return Boolean(window.__nexusAndroidHandleBack && window.__nexusAndroidHandleBack()); })()"
                    ) { result ->
                        val handled = result?.trim() == "true"
                        if (!handled) {
                            if (webView.canGoBack()) {
                                webView.goBack()
                            } else {
                                promptDoubleBackExit()
                            }
                        }
                    }
                }
            }
        )
    }

    private fun promptDoubleBackExit() {
        val now = System.currentTimeMillis()
        if (now - lastBackExitPromptMs < 2000L) {
            finish()
        } else {
            lastBackExitPromptMs = now
            Toast.makeText(this, getString(R.string.press_back_again), Toast.LENGTH_SHORT).show()
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
}
