package com.nexus.eva

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject

/**
 * Typed JavaScript <-> Kotlin native bridge exposed to the web app as `window.NexusAndroid`.
 * Provides Material 3 haptics, Foreground Voice Service lifecycle, Server URL Picker trigger,
 * edge-to-edge system bar theme sync, and platform metadata.
 */
class EvaJsBridge(
    private val activity: MainActivity,
    private val serverPrefs: ServerPrefs,
) {

    @JavascriptInterface
    fun getPlatformInfo(): String {
        val json = JSONObject().apply {
            put("isAndroidApk", true)
            put("platform", "android")
            put("sdkInt", Build.VERSION.SDK_INT)
            put("model", Build.MODEL ?: "Android")
            put("manufacturer", Build.MANUFACTURER ?: "")
            put("appVersion", BuildConfig.VERSION_NAME)
            put("serverUrl", serverPrefs.getActiveUrl() ?: "")
            put("nativeWakeSupported", true)
        }
        return json.toString()
    }

    @JavascriptInterface
    fun haptic(style: String?) {
        activity.runOnUiThread {
            val vibrator = getVibrator() ?: return@runOnUiThread
            if (!vibrator.hasVibrator()) return@runOnUiThread

            val effect = when (style?.lowercase()) {
                "selection" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
                } else {
                    VibrationEffect.createOneShot(12, 80)
                }
                "light" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
                } else {
                    VibrationEffect.createOneShot(18, 120)
                }
                "medium" -> VibrationEffect.createOneShot(28, 175)
                "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK)
                } else {
                    VibrationEffect.createWaveform(longArrayOf(0, 18, 45, 24), -1)
                }
                "warning" -> VibrationEffect.createWaveform(longArrayOf(0, 32, 40, 32), -1)
                else -> VibrationEffect.createOneShot(16, 110)
            }
            runCatching { vibrator.vibrate(effect) }
        }
    }

    @JavascriptInterface
    fun startVoiceService(statusText: String?) {
        activity.runOnUiThread {
            activity.startForegroundVoice(statusText ?: "Eva Live Voice is active")
        }
    }

    @JavascriptInterface
    fun stopVoiceService() {
        activity.runOnUiThread {
            activity.stopForegroundVoice()
        }
    }

    @JavascriptInterface
    fun startNativeWakeListener(wakePhrase: String?, serverUrl: String?) {
        activity.runOnUiThread {
            activity.startNativeWakeListener(
                wakePhrase = wakePhrase?.takeIf { it.isNotBlank() } ?: WakePhraseMatcher.DEFAULT_WAKE_PHRASE,
                serverUrl = serverUrl?.takeIf { it.isNotBlank() } ?: serverPrefs.getActiveUrl(),
            )
        }
    }

    @JavascriptInterface
    fun pauseNativeWakeListener(statusText: String?) {
        activity.runOnUiThread {
            activity.pauseNativeWakeListener(statusText ?: "Eva is listening live…")
        }
    }

    @JavascriptInterface
    fun stopNativeWakeListener() {
        activity.runOnUiThread {
            activity.stopForegroundVoice()
        }
    }

    @JavascriptInterface
    fun getNativeServiceState(): String {
        return EvaVoiceForegroundService.currentSnapshot.toJson().toString()
    }

    @JavascriptInterface
    fun openServerPicker() {
        activity.runOnUiThread {
            activity.showServerPicker(cancelable = true)
        }
    }

    @JavascriptInterface
    fun setSystemBarsTheme(isDark: Boolean) {
        activity.runOnUiThread {
            activity.applySystemBarsTheme(isDark)
        }
    }

    @JavascriptInterface
    fun showToast(message: String?) {
        val text = message?.trim().orEmpty()
        if (text.isEmpty()) return
        activity.runOnUiThread {
            Toast.makeText(activity, text, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String?): Boolean {
        val safeUrl = url?.trim().orEmpty()
        if (!safeUrl.startsWith("http://", ignoreCase = true) &&
            !safeUrl.startsWith("https://", ignoreCase = true)
        ) {
            return false
        }
        activity.runOnUiThread {
            runCatching {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl))
                activity.startActivity(intent)
            }
        }
        return true
    }

    @Suppress("DEPRECATION")
    private fun getVibrator(): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator
        } else {
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }
}
