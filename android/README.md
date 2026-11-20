# Nexus Eva — Native Android APK Package

Native Kotlin + Material 3 Android Studio project (`com.nexus.eva`) that packages Nexus Eva as an installable Android APK with full device bridge support alongside Web/PWA and Desktop (`/electron`).

## Native Capabilities Included
- **Microphone & Camera Runtime Delegation**: Automatically requests Android `RECORD_AUDIO` and `CAMERA` permissions and grants WebView media requests for Gemini Live Voice, Wake Ear, and Face-First Gaze Tracking.
- **Foreground Voice Service (`microphone`)**: Keeps Eva Voice alive with a persistent notification (and a one-tap **Stop Voice** notification button) even when you switch apps or lock your screen.
- **Native Material 3 Haptics**: Exposes `window.NexusAndroid.haptic(style)` using Android `VibrationEffect` APIs.
- **System Back Gesture Stack**: Routes Android predictive/hardware Back gestures into `window.__nexusAndroidHandleBack()` to dismiss bottom sheets, close split panels, and step back cleanly before prompting to exit.
- **Saved Server URL Picker**: Connect to any Cloud HTTPS deployment, local Wi-Fi LAN IP (`http://192.168.x.x:3000`), or USB ADB reverse tunnel (`http://127.0.0.1:3000`), with a live `/api/health` connection check and saved history.

## Building the APK

### Option 1: Android Studio (Recommended)
1. Open the `/android` folder in **Android Studio** (Ladybug or newer, JDK 17).
2. Let Gradle sync finish.
3. Click **Build → Build Bundle(s) / APK(s) → Build APK(s)** (or run directly on a connected phone).

### Option 2: Command Line (Gradle)
```bash
cd android
gradle assembleDebug
# Output APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Optionally bake a default Cloud URL into the build:
```bash
gradle assembleRelease -PNEXUS_DEFAULT_URL="https://your-nexus-eva-host.run.app"
```

## Connecting to Your Local Server Over USB
If running Nexus Eva locally on port `3000` with a phone plugged in via USB:
```bash
adb reverse tcp:3000 tcp:3000
```
Then open the Nexus Eva APK and tap the **USB ADB (127.0.0.1:3000)** preset in the Server Picker.
