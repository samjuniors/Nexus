package com.nexus.eva

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.sqrt

/**
 * Persistent Android 14+ Foreground Microphone Service for Nexus Eva.
 *
 * Responsibilities:
 * - Maintains a persistent connection heartbeat to the active Nexus Eva server.
 * - Runs a native microphone wake-word listener ("Hey Eva" / "Eva" / "Evay") using
 *   Android SpeechRecognizer with automatic AudioRecord + /api/wake acoustic fallback.
 * - Immediately releases the native mic on keyword detection and broadcasts to MainActivity
 *   so the WebView transitions straight into Listening mode without manual UI interaction.
 */
class EvaVoiceForegroundService : Service() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var wakeLock: PowerManager.WakeLock? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var heartbeatJob: Job? = null
    private var acousticJob: Job? = null

    private var desiredMode: String = MODE_ARMED
    private var wakePhrase: String = WakePhraseMatcher.DEFAULT_WAKE_PHRASE
    private var serverUrl: String = ""
    private var consecutiveSpeechErrors: Int = 0
    private var lastWakeTimestampMs: Long = 0L
    private var isListeningNative: Boolean = false

    private val restartSpeechRunnable = Runnable {
        if (desiredMode == MODE_ARMED) {
            beginSpeechRecognition()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        serverUrl = ServerPrefs(this).getActiveUrl().orEmpty()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START_OR_UPDATE
        when (action) {
            ACTION_STOP_FROM_NOTIFICATION -> {
                releaseAllListeners()
                updateSnapshot(listenerState = STATE_IDLE, connectionState = CONN_DISCONNECTED)
                sendBroadcast(Intent(BROADCAST_VOICE_STOPPED).setPackage(packageName))
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_STOP -> {
                releaseAllListeners()
                updateSnapshot(listenerState = STATE_IDLE, connectionState = CONN_DISCONNECTED)
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_ARM_WAKE -> {
                wakePhrase = intent?.getStringExtra(EXTRA_WAKE_PHRASE)
                    ?.takeIf { it.isNotBlank() }
                    ?: wakePhrase
                intent?.getStringExtra(EXTRA_SERVER_URL)?.takeIf { it.isNotBlank() }?.let {
                    serverUrl = it.trimEnd('/')
                }
                desiredMode = MODE_ARMED
                promoteForeground(getString(R.string.voice_notification_armed))
                acquireWakeLock()
                startConnectionHeartbeat()
                armNativeMicrophoneListener()
            }

            ACTION_PAUSE_WAKE -> {
                desiredMode = MODE_LISTENING
                val status = intent?.getStringExtra(EXTRA_STATUS_TEXT)
                    ?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.voice_notification_listening)
                releaseAllListeners()
                promoteForeground(status)
                acquireWakeLock()
                startConnectionHeartbeat()
                updateSnapshot(listenerState = STATE_LISTENING)
            }

            else -> {
                val status = intent?.getStringExtra(EXTRA_STATUS_TEXT)
                    ?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.voice_notification_listening)
                desiredMode = MODE_LISTENING
                releaseAllListeners()
                promoteForeground(status)
                acquireWakeLock()
                startConnectionHeartbeat()
                updateSnapshot(listenerState = STATE_LISTENING)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        releaseAllListeners()
        heartbeatJob?.cancel()
        serviceScope.cancel()
        releaseWakeLock()
        updateSnapshot(listenerState = STATE_IDLE, connectionState = CONN_DISCONNECTED)
        super.onDestroy()
    }

    private fun promoteForeground(statusText: String) {
        val notification = buildNotification(statusText)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun hasRecordAudioPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun armNativeMicrophoneListener() {
        if (!hasRecordAudioPermission()) {
            updateSnapshot(listenerState = STATE_AWAITING_PERMISSION)
            return
        }
        consecutiveSpeechErrors = 0
        mainHandler.removeCallbacks(restartSpeechRunnable)
        stopAcousticFallback()

        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            updateSnapshot(listenerState = STATE_ARMED, engine = "android-speech")
            beginSpeechRecognition()
        } else {
            updateSnapshot(listenerState = STATE_ARMED, engine = "android-acoustic")
            startAcousticFallback()
        }
    }

    private fun beginSpeechRecognition() {
        if (desiredMode != MODE_ARMED || !hasRecordAudioPermission()) return
        mainHandler.post {
            if (desiredMode != MODE_ARMED) return@post
            destroySpeechRecognizer()

            val recognizer = runCatching {
                SpeechRecognizer.createSpeechRecognizer(this)
            }.getOrNull()

            if (recognizer == null) {
                startAcousticFallback()
                return@post
            }

            speechRecognizer = recognizer
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    isListeningNative = true
                    consecutiveSpeechErrors = 0
                    updateSnapshot(listenerState = STATE_ARMED, engine = "android-speech")
                }

                override fun onBeginningOfSpeech() = Unit

                override fun onRmsChanged(rmsdB: Float) {
                    val normalized = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                    currentSnapshot = currentSnapshot.copy(audioLevel = normalized)
                }

                override fun onBufferReceived(buffer: ByteArray?) = Unit

                override fun onEndOfSpeech() {
                    isListeningNative = false
                }

                override fun onError(error: Int) {
                    isListeningNative = false
                    if (desiredMode != MODE_ARMED) return

                    val benign = error == SpeechRecognizer.ERROR_NO_MATCH ||
                        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    if (benign) {
                        consecutiveSpeechErrors = 0
                        scheduleSpeechRestart(260L)
                        return
                    }

                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        updateSnapshot(listenerState = STATE_AWAITING_PERMISSION)
                        return
                    }

                    consecutiveSpeechErrors += 1
                    if (consecutiveSpeechErrors >= 3 && serverUrl.isNotBlank()) {
                        destroySpeechRecognizer()
                        updateSnapshot(listenerState = STATE_ARMED, engine = "android-acoustic")
                        startAcousticFallback()
                    } else {
                        val backoff = (500L * consecutiveSpeechErrors).coerceAtMost(2500L)
                        scheduleSpeechRestart(backoff)
                    }
                }

                override fun onResults(results: Bundle?) {
                    isListeningNative = false
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (!handleCandidateTranscripts(matches)) {
                        scheduleSpeechRestart(220L)
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    handleCandidateTranscripts(matches)
                }

                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })

            val recIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 900L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 700L)
            }

            runCatching {
                recognizer.startListening(recIntent)
            }.onFailure {
                startAcousticFallback()
            }
        }
    }

    private fun handleCandidateTranscripts(matches: List<String>?): Boolean {
        if (desiredMode != MODE_ARMED || matches.isNullOrEmpty()) return false
        val result = WakePhraseMatcher.matchCandidates(matches, wakePhrase)
        if (!result.matched) return false

        val transcript = matches.firstOrNull().orEmpty()
        triggerWakeTransition(
            matchedPhrase = result.matchedPhrase,
            trailingCommand = result.trailingCommand,
            transcript = transcript,
        )
        return true
    }

    /**
     * Native AudioRecord 16kHz PCM16 voice-activity fallback for devices without Google SpeechRecognizer.
     */
    private fun startAcousticFallback() {
        stopAcousticFallback()
        if (desiredMode != MODE_ARMED || !hasRecordAudioPermission()) return

        acousticJob = serviceScope.launch {
            val sampleRate = 16000
            val minBuf = AudioRecord.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            if (minBuf <= 0) return@launch

            val recorder = try {
                AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    minBuf * 2
                )
            } catch (_: SecurityException) {
                updateSnapshot(listenerState = STATE_AWAITING_PERMISSION)
                return@launch
            }

            if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                recorder.release()
                return@launch
            }

            val frameSize = 1600 // 100ms at 16kHz
            val frame = ShortArray(frameSize)
            val preRoll = ArrayDeque<ShortArray>()
            val burst = mutableListOf<ShortArray>()
            var inSpeech = false
            var speechFrames = 0
            var silenceFrames = 0

            try {
                recorder.startRecording()
                updateSnapshot(listenerState = STATE_ARMED, engine = "android-acoustic")

                while (isActive && desiredMode == MODE_ARMED) {
                    val read = recorder.read(frame, 0, frame.size)
                    if (read <= 0) {
                        delay(40)
                        continue
                    }

                    val copy = frame.copyOf(read)
                    val rms = computeRms(copy)
                    currentSnapshot = currentSnapshot.copy(audioLevel = (rms * 5f).coerceIn(0f, 1f))

                    if (rms >= 0.015f) {
                        if (!inSpeech) {
                            inSpeech = true
                            burst.clear()
                            burst.addAll(preRoll)
                            speechFrames = 0
                        }
                        burst.add(copy)
                        speechFrames += 1
                        silenceFrames = 0
                    } else if (inSpeech) {
                        burst.add(copy)
                        silenceFrames += 1
                    } else {
                        preRoll.addLast(copy)
                        while (preRoll.size > 4) preRoll.removeFirst()
                    }

                    val burstDone = inSpeech && (silenceFrames >= 5 || burst.size >= 26)
                    if (burstDone) {
                        inSpeech = false
                        val enoughSpeech = speechFrames >= 2
                        val captured = if (enoughSpeech) burst.toList() else emptyList()
                        burst.clear()
                        speechFrames = 0
                        silenceFrames = 0

                        if (captured.isNotEmpty() && serverUrl.isNotBlank()) {
                            verifyAcousticBurst(captured, sampleRate)
                        }
                    }
                }
            } finally {
                runCatching { recorder.stop() }
                runCatching { recorder.release() }
            }
        }
    }

    private fun verifyAcousticBurst(frames: List<ShortArray>, sampleRate: Int) {
        if (desiredMode != MODE_ARMED || serverUrl.isBlank()) return
        val wavBytes = encodeMonoWav(frames, sampleRate)
        val b64 = Base64.encodeToString(wavBytes, Base64.NO_WRAP)

        val endpoint = "$serverUrl/api/wake"
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 4500
                readTimeout = 6500
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            val payload = JSONObject().apply {
                put("audioBase64", b64)
                put("mimeType", "audio/wav")
                put("wakePhrase", wakePhrase)
            }.toString()
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }

            if (conn.responseCode in 200..299) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                if (json.optBoolean("matched", false)) {
                    triggerWakeTransition(
                        matchedPhrase = json.optString("matchedPhrase", wakePhrase),
                        trailingCommand = json.optString("trailingCommand", ""),
                        transcript = json.optString("transcript", ""),
                    )
                }
            }
        } catch (_: Throwable) {
            // Non-fatal network blip; keep listening continuously
        } finally {
            conn?.disconnect()
        }
    }

    private fun triggerWakeTransition(
        matchedPhrase: String,
        trailingCommand: String,
        transcript: String,
    ) {
        val now = System.currentTimeMillis()
        if (now - lastWakeTimestampMs < 1800L) return
        lastWakeTimestampMs = now

        // 1. Release native mic immediately so the WebView can acquire it with zero contention
        desiredMode = MODE_LISTENING
        releaseAllListeners()

        // 2. Update persistent foreground notification & snapshot
        promoteForeground(getString(R.string.voice_notification_listening))
        updateSnapshot(listenerState = STATE_LISTENING)

        // 3. Broadcast wake detection event to MainActivity -> WebView bridge
        val wakeIntent = Intent(BROADCAST_WAKE_DETECTED).apply {
            setPackage(packageName)
            putExtra(EXTRA_MATCHED_PHRASE, matchedPhrase)
            putExtra(EXTRA_TRAILING_COMMAND, trailingCommand)
            putExtra(EXTRA_TRANSCRIPT, transcript)
            putExtra(EXTRA_WAKE_TIMESTAMP, now)
        }
        sendBroadcast(wakeIntent)

        // 4. Bring MainActivity forward if backgrounded so the WebView activates Listening hands-free
        runCatching {
            val bringFront = Intent(this, MainActivity::class.java).apply {
                action = ACTION_WAKE_BRING_FRONT
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                putExtra(EXTRA_MATCHED_PHRASE, matchedPhrase)
                putExtra(EXTRA_TRAILING_COMMAND, trailingCommand)
                putExtra(EXTRA_TRANSCRIPT, transcript)
                putExtra(EXTRA_WAKE_TIMESTAMP, now)
            }
            startActivity(bringFront)
        }
    }

    private fun startConnectionHeartbeat() {
        if (heartbeatJob?.isActive == true) return
        heartbeatJob = serviceScope.launch {
            while (isActive) {
                val base = serverUrl.ifBlank { ServerPrefs(this@EvaVoiceForegroundService).getActiveUrl().orEmpty() }
                if (base.isNotBlank()) {
                    val reachable = checkServerHealth(base)
                    updateSnapshot(
                        connectionState = if (reachable) CONN_CONNECTED else CONN_RECONNECTING,
                        lastHeartbeatMs = if (reachable) System.currentTimeMillis() else currentSnapshot.lastHeartbeatMs,
                    )
                }
                delay(25_000L)
            }
        }
    }

    private fun checkServerHealth(baseUrl: String): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("${baseUrl.trimEnd('/')}/api/health").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 4000
                readTimeout = 4000
            }
            conn.responseCode in 200..299
        } catch (_: Throwable) {
            false
        } finally {
            conn?.disconnect()
        }
    }

    private fun scheduleSpeechRestart(delayMs: Long) {
        mainHandler.removeCallbacks(restartSpeechRunnable)
        if (desiredMode == MODE_ARMED) {
            mainHandler.postDelayed(restartSpeechRunnable, delayMs)
        }
    }

    private fun releaseAllListeners() {
        mainHandler.removeCallbacks(restartSpeechRunnable)
        stopAcousticFallback()
        mainHandler.post { destroySpeechRecognizer() }
    }

    private fun stopAcousticFallback() {
        acousticJob?.cancel()
        acousticJob = null
    }

    private fun destroySpeechRecognizer() {
        isListeningNative = false
        speechRecognizer?.let { rec ->
            runCatching { rec.stopListening() }
            runCatching { rec.cancel() }
            runCatching { rec.destroy() }
        }
        speechRecognizer = null
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NexusEva::WakeListenerLock").apply {
            setReferenceCounted(false)
            runCatching { acquire(60 * 60 * 1000L) }
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { lock ->
            if (lock.isHeld) runCatching { lock.release() }
        }
        wakeLock = null
    }

    private fun updateSnapshot(
        listenerState: String = currentSnapshot.listenerState,
        connectionState: String = currentSnapshot.connectionState,
        engine: String = currentSnapshot.engine,
        lastHeartbeatMs: Long = currentSnapshot.lastHeartbeatMs,
    ) {
        currentSnapshot = ServiceSnapshot(
            listenerState = listenerState,
            connectionState = connectionState,
            wakePhrase = wakePhrase,
            engine = engine,
            lastHeartbeatMs = lastHeartbeatMs,
            audioLevel = currentSnapshot.audioLevel,
        )
        val stateIntent = Intent(BROADCAST_STATE_CHANGED).apply {
            setPackage(packageName)
            putExtra(EXTRA_STATE_JSON, currentSnapshot.toJson().toString())
        }
        sendBroadcast(stateIntent)
    }

    private fun ensureChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.voice_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.voice_channel_desc)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(statusText: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, EvaVoiceForegroundService::class.java).apply {
            action = ACTION_STOP_FROM_NOTIFICATION
        }
        val stopPending = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_voice_notification)
            .setContentTitle(getString(R.string.voice_notification_title))
            .setContentText(statusText)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openPending)
            .addAction(0, getString(R.string.voice_notification_stop), stopPending)
            .build()
    }

    private fun computeRms(samples: ShortArray): Float {
        if (samples.isEmpty()) return 0f
        var acc = 0.0
        for (s in samples) {
            val f = s / 32768.0
            acc += f * f
        }
        return sqrt(acc / samples.size).toFloat()
    }

    private fun encodeMonoWav(chunks: List<ShortArray>, sampleRate: Int): ByteArray {
        val totalSamples = chunks.sumOf { it.size }
        val pcmBytes = totalSamples * 2
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(36 + pcmBytes)
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1)
            putShort(1)
            putInt(sampleRate)
            putInt(sampleRate * 2)
            putShort(2)
            putShort(16)
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(pcmBytes)
        }.array()

        val out = ByteArrayOutputStream(44 + pcmBytes)
        out.write(header)
        val sampleBuf = ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN)
        for (chunk in chunks) {
            for (s in chunk) {
                sampleBuf.clear()
                sampleBuf.putShort(s)
                out.write(sampleBuf.array())
            }
        }
        return out.toByteArray()
    }

    data class ServiceSnapshot(
        val listenerState: String = STATE_IDLE,
        val connectionState: String = CONN_DISCONNECTED,
        val wakePhrase: String = WakePhraseMatcher.DEFAULT_WAKE_PHRASE,
        val engine: String = "android-speech",
        val lastHeartbeatMs: Long = 0L,
        val audioLevel: Float = 0f,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("listenerState", listenerState)
            put("connectionState", connectionState)
            put("wakePhrase", wakePhrase)
            put("engine", engine)
            put("lastHeartbeatMs", lastHeartbeatMs)
            put("audioLevel", audioLevel.toDouble())
            put("nativeWakeSupported", true)
        }
    }

    companion object {
        const val CHANNEL_ID = "nexus_eva_voice_channel"
        const val NOTIFICATION_ID = 4108

        const val ACTION_START_OR_UPDATE = "com.nexus.eva.action.START_VOICE"
        const val ACTION_ARM_WAKE = "com.nexus.eva.action.ARM_WAKE"
        const val ACTION_PAUSE_WAKE = "com.nexus.eva.action.PAUSE_WAKE"
        const val ACTION_STOP = "com.nexus.eva.action.STOP_VOICE"
        const val ACTION_STOP_FROM_NOTIFICATION = "com.nexus.eva.action.STOP_VOICE_FROM_NOTIFICATION"
        const val ACTION_WAKE_BRING_FRONT = "com.nexus.eva.action.WAKE_BRING_FRONT"

        const val BROADCAST_VOICE_STOPPED = "com.nexus.eva.broadcast.VOICE_STOPPED"
        const val BROADCAST_WAKE_DETECTED = "com.nexus.eva.broadcast.WAKE_DETECTED"
        const val BROADCAST_STATE_CHANGED = "com.nexus.eva.broadcast.STATE_CHANGED"

        const val EXTRA_STATUS_TEXT = "status_text"
        const val EXTRA_WAKE_PHRASE = "wake_phrase"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_MATCHED_PHRASE = "matched_phrase"
        const val EXTRA_TRAILING_COMMAND = "trailing_command"
        const val EXTRA_TRANSCRIPT = "transcript"
        const val EXTRA_WAKE_TIMESTAMP = "wake_timestamp"
        const val EXTRA_STATE_JSON = "state_json"

        const val MODE_ARMED = "armed"
        const val MODE_LISTENING = "listening"

        const val STATE_IDLE = "idle"
        const val STATE_ARMED = "armed"
        const val STATE_LISTENING = "listening"
        const val STATE_AWAITING_PERMISSION = "awaiting-permission"

        const val CONN_CONNECTED = "connected"
        const val CONN_RECONNECTING = "reconnecting"
        const val CONN_DISCONNECTED = "disconnected"

        @Volatile
        var currentSnapshot: ServiceSnapshot = ServiceSnapshot()
            private set

        fun start(context: Context, statusText: String) {
            dispatchServiceIntent(
                context,
                Intent(context, EvaVoiceForegroundService::class.java).apply {
                    action = ACTION_START_OR_UPDATE
                    putExtra(EXTRA_STATUS_TEXT, statusText)
                }
            )
        }

        fun armWakeListener(context: Context, wakePhrase: String, serverUrl: String?) {
            dispatchServiceIntent(
                context,
                Intent(context, EvaVoiceForegroundService::class.java).apply {
                    action = ACTION_ARM_WAKE
                    putExtra(EXTRA_WAKE_PHRASE, wakePhrase)
                    if (!serverUrl.isNullOrBlank()) {
                        putExtra(EXTRA_SERVER_URL, serverUrl)
                    }
                }
            )
        }

        fun pauseWakeForLiveVoice(context: Context, statusText: String) {
            dispatchServiceIntent(
                context,
                Intent(context, EvaVoiceForegroundService::class.java).apply {
                    action = ACTION_PAUSE_WAKE
                    putExtra(EXTRA_STATUS_TEXT, statusText)
                }
            )
        }

        fun stop(context: Context) {
            val intent = Intent(context, EvaVoiceForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            runCatching { context.startService(intent) }
        }

        private fun dispatchServiceIntent(context: Context, intent: Intent) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
