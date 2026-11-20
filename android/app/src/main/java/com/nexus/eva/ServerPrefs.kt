package com.nexus.eva

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ServerHealthResult(
    val ok: Boolean,
    val normalizedUrl: String,
    val latencyMs: Long,
    val message: String,
)

/**
 * Persistent server URL preferences and live /api/health probe helper for the
 * Nexus Eva Android APK. Supports Cloud HTTPS endpoints, local Wi-Fi LAN IPs,
 * and USB ADB reverse tunnels (http://127.0.0.1:3000).
 */
class ServerPrefs(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getActiveUrl(): String? {
        val saved = prefs.getString(KEY_ACTIVE_URL, null)?.trim()
        if (!saved.isNullOrEmpty()) return saved
        val buildDefault = BuildConfig.DEFAULT_SERVER_URL.trim()
        return buildDefault.ifEmpty { null }
    }

    fun setActiveUrl(rawUrl: String): String {
        val normalized = normalizeUrl(rawUrl)
        val history = getSavedUrls().toMutableList()
        history.removeAll { it.equals(normalized, ignoreCase = true) }
        history.add(0, normalized)
        val trimmed = history.take(MAX_SAVED_URLS)

        val json = JSONArray()
        trimmed.forEach { json.put(it) }

        prefs.edit()
            .putString(KEY_ACTIVE_URL, normalized)
            .putString(KEY_SAVED_URLS, json.toString())
            .apply()

        return normalized
    }

    fun getSavedUrls(): List<String> {
        val raw = prefs.getString(KEY_SAVED_URLS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val value = arr.optString(i).trim()
                    if (value.isNotEmpty()) add(value)
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun removeSavedUrl(url: String) {
        val remaining = getSavedUrls().filterNot { it.equals(url, ignoreCase = true) }
        val json = JSONArray()
        remaining.forEach { json.put(it) }
        prefs.edit().putString(KEY_SAVED_URLS, json.toString()).apply()
    }

    companion object {
        private const val PREFS_NAME = "nexus_eva_server_prefs"
        private const val KEY_ACTIVE_URL = "active_server_url"
        private const val KEY_SAVED_URLS = "saved_server_urls"
        private const val MAX_SAVED_URLS = 8

        const val PRESET_USB_ADB = "http://127.0.0.1:3000"
        const val PRESET_EMULATOR_HOST = "http://10.0.2.2:3000"
        const val PRESET_LAN_TEMPLATE = "http://192.168.1.100:3000"

        /**
         * Normalizes user-entered Cloud URLs, LAN IPs, or loopback hosts into a clean base URL.
         * Uses http:// for local LAN/loopback hosts and https:// for remote cloud hostnames.
         */
        fun normalizeUrl(input: String): String {
            val trimmed = input.trim().trimEnd('/')
            if (trimmed.isEmpty()) return ""
            val schemeMatch = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://").find(trimmed)
            if (schemeMatch != null) {
                val explicitScheme = schemeMatch.groupValues[1].lowercase()
                if (explicitScheme != "http" && explicitScheme != "https") return ""
            }
            val withScheme = if (schemeMatch != null) {
                trimmed
            } else {
                val lower = trimmed.lowercase()
                val isLocalHost = lower.startsWith("localhost") ||
                    lower.startsWith("127.") ||
                    lower.startsWith("10.") ||
                    lower.startsWith("192.168.") ||
                    lower.matches(Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\..*")) ||
                    lower.endsWith(".local") ||
                    lower.contains(":3000")
                if (isLocalHost) "http://$trimmed" else "https://$trimmed"
            }

            val parsed = Uri.parse(withScheme)
            val scheme = parsed.scheme?.lowercase() ?: return ""
            if (scheme != "http" && scheme != "https") return ""
            if (parsed.host.isNullOrBlank()) return ""
            return withScheme.trimEnd('/')
        }

        /**
         * Probes GET {baseUrl}/api/health to verify the Nexus Eva server is reachable before loading.
         */
        suspend fun probeHealth(rawUrl: String): ServerHealthResult = withContext(Dispatchers.IO) {
            val normalized = normalizeUrl(rawUrl)
            if (normalized.isEmpty()) {
                return@withContext ServerHealthResult(
                    ok = false,
                    normalizedUrl = "",
                    latencyMs = 0L,
                    message = "Enter a valid Cloud URL or LAN IP address."
                )
            }

            val start = System.currentTimeMillis()
            var connection: HttpURLConnection? = null
            try {
                val url = URL("$normalized/api/health")
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 5500
                    readTimeout = 5500
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("X-Nexus-Client", "android-apk")
                }

                val code = connection.responseCode
                val latency = System.currentTimeMillis() - start
                if (code in 200..299) {
                    val body = connection.inputStream.bufferedReader().use { it.readText() }
                    val json = runCatching { JSONObject(body) }.getOrNull()
                    val appName = json?.optString("app").orEmpty().ifEmpty { "Nexus Eva" }
                    ServerHealthResult(
                        ok = true,
                        normalizedUrl = normalized,
                        latencyMs = latency,
                        message = "Connected to $appName (${latency}ms)"
                    )
                } else {
                    ServerHealthResult(
                        ok = false,
                        normalizedUrl = normalized,
                        latencyMs = latency,
                        message = "Server responded with HTTP $code"
                    )
                }
            } catch (e: Exception) {
                val latency = System.currentTimeMillis() - start
                ServerHealthResult(
                    ok = false,
                    normalizedUrl = normalized,
                    latencyMs = latency,
                    message = e.localizedMessage ?: "Unable to reach server"
                )
            } finally {
                connection?.disconnect()
            }
        }
    }
}
