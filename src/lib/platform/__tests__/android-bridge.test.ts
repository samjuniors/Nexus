import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  __resetBackHandlersForTest,
  detectPlatformInfo,
  dispatchAndroidBack,
  ensureGlobalAndroidHooks,
  getNativeServiceState,
  hasNativeWakeListener,
  normalizeServerUrl,
  onAndroidServiceStateChange,
  onAndroidWakeDetected,
  openAndroidServerPicker,
  pauseNativeWakeListener,
  registerBackHandler,
  startNativeWakeListener,
  stopNativeWakeListener,
  syncForegroundVoice,
  syncSystemBarsTheme,
  triggerHaptic,
  type NativeServiceState,
  type NativeWakeEvent,
} from '../android-bridge'

describe('Android APK & Cross-Platform Bridge', () => {
  beforeEach(() => {
    __resetBackHandlersForTest()
  })

  it('normalizes Cloud URLs, LAN IPs, and USB ADB addresses consistently', () => {
    assert.equal(normalizeServerUrl('eva.example.com/'), 'https://eva.example.com')
    assert.equal(normalizeServerUrl('https://my-host.run.app///'), 'https://my-host.run.app')
    assert.equal(normalizeServerUrl('192.168.1.42:3000'), 'http://192.168.1.42:3000')
    assert.equal(normalizeServerUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000')
    assert.equal(normalizeServerUrl('10.0.2.2:3000'), 'http://10.0.2.2:3000')
    assert.equal(normalizeServerUrl('localhost:3000'), 'http://localhost:3000')
    assert.equal(normalizeServerUrl('   '), '')
    assert.equal(normalizeServerUrl('ftp://invalid-scheme.local'), '')
  })

  it('detects Android APK, Electron Desktop, PWA standalone, and Web Browser runtimes', () => {
    const androidWin = {
      NexusAndroid: {
        getPlatformInfo: () =>
          JSON.stringify({
            isAndroidApk: true,
            model: 'Pixel 9',
            sdkInt: 35,
            appVersion: '1.0.0',
            serverUrl: 'https://eva.cloud',
            nativeWakeSupported: true,
          }),
      },
    } as unknown as Window
    const androidInfo = detectPlatformInfo(androidWin)
    assert.equal(androidInfo.runtime, 'android-apk')
    assert.equal(androidInfo.isAndroidApk, true)
    assert.equal(androidInfo.nativeWakeSupported, true)
    assert.equal(androidInfo.deviceModel, 'Pixel 9')
    assert.equal(androidInfo.serverUrl, 'https://eva.cloud')

    const desktopWin = { nexusDesktop: { isElectron: true } } as unknown as Window
    assert.equal(detectPlatformInfo(desktopWin).runtime, 'electron-desktop')

    const pwaWin = {
      matchMedia: () => ({ matches: true }),
      navigator: {},
    } as unknown as Window
    assert.equal(detectPlatformInfo(pwaWin).runtime, 'pwa-standalone')

    const browserWin = {
      matchMedia: () => ({ matches: false }),
      navigator: {},
    } as unknown as Window
    assert.equal(detectPlatformInfo(browserWin).runtime, 'web-browser')
  })

  it('routes haptics to Android JS bridge first and falls back to navigator.vibrate on web', () => {
    const calls: string[] = []
    const androidWin = {
      NexusAndroid: {
        haptic: (style: string) => calls.push(style),
      },
    } as unknown as Window
    assert.equal(triggerHaptic('success', androidWin), true)
    assert.deepEqual(calls, ['success'])

    let webPattern: unknown = null
    const webWin = {
      navigator: {
        vibrate: (pattern: number | number[]) => {
          webPattern = pattern
          return true
        },
      },
    } as unknown as Window
    assert.equal(triggerHaptic('medium', webWin), true)
    assert.equal(webPattern, 26)
  })

  it('syncs foreground voice service, system bars theme, and server picker via Android bridge', () => {
    const events: string[] = []
    const androidWin = {
      NexusAndroid: {
        haptic: (s: string) => events.push(`haptic:${s}`),
        startVoiceService: (t: string) => events.push(`start:${t}`),
        stopVoiceService: () => events.push('stop'),
        setSystemBarsTheme: (dark: boolean) => events.push(`bars:${dark}`),
        openServerPicker: () => events.push('picker'),
      },
    } as unknown as Window

    syncForegroundVoice(true, 'Listening live', androidWin)
    syncForegroundVoice(false, '', androidWin)
    syncSystemBarsTheme(true, androidWin)
    assert.equal(openAndroidServerPicker(androidWin), true)

    assert.deepEqual(events, [
      'start:Listening live',
      'stop',
      'bars:true',
      'haptic:light',
      'picker',
    ])
  })

  it('manages native Android foreground wake listener lifecycle and persistent service state', () => {
    const calls: string[] = []
    const androidWin = {
      NexusAndroid: {
        haptic: (s: string) => calls.push(`haptic:${s}`),
        startNativeWakeListener: (phrase: string, url: string) =>
          calls.push(`arm:${phrase}@${url}`),
        pauseNativeWakeListener: (status: string) => calls.push(`pause:${status}`),
        stopNativeWakeListener: () => calls.push('stop-wake'),
        getNativeServiceState: () =>
          JSON.stringify({
            listenerState: 'armed',
            connectionState: 'connected',
            wakePhrase: 'Hey Eva',
            engine: 'android-speech',
            lastHeartbeatMs: 1700000000000,
            audioLevel: 0.25,
            nativeWakeSupported: true,
          }),
      },
    } as unknown as Window

    assert.equal(hasNativeWakeListener(androidWin), true)
    assert.equal(startNativeWakeListener('Hey Eva', 'https://eva.cloud', androidWin), true)
    assert.equal(pauseNativeWakeListener('Eva is listening live…', androidWin), true)
    assert.equal(stopNativeWakeListener(androidWin), true)

    const snapshot = getNativeServiceState(androidWin)
    assert.equal(snapshot?.listenerState, 'armed')
    assert.equal(snapshot?.connectionState, 'connected')
    assert.equal(snapshot?.engine, 'android-speech')

    const seenStates: NativeServiceState[] = []
    const unsubState = onAndroidServiceStateChange((s) => seenStates.push(s), androidWin)
    androidWin.__nexusAndroidOnServiceState?.(
      JSON.stringify({
        listenerState: 'listening',
        connectionState: 'connected',
        wakePhrase: 'Hey Eva',
        engine: 'android-speech',
        lastHeartbeatMs: 1700000005000,
        audioLevel: 0.6,
      })
    )
    unsubState()

    assert.equal(seenStates.length, 2)
    assert.equal(seenStates[0].listenerState, 'armed')
    assert.equal(seenStates[1].listenerState, 'listening')

    assert.deepEqual(calls, [
      'arm:Hey Eva@https://eva.cloud',
      'pause:Eva is listening live…',
      'stop-wake',
    ])
  })

  it('delivers native Hey Eva wake events immediately and buffers early wakes until WebView subscribes', () => {
    const haptics: string[] = []
    const androidWin = {
      NexusAndroid: {
        haptic: (s: string) => haptics.push(s),
      },
    } as unknown as Window

    ensureGlobalAndroidHooks(androidWin)

    // Fire wake event BEFORE React mounts its subscriber -> should be buffered
    androidWin.__nexusAndroidOnWakeDetected?.(
      JSON.stringify({
        matchedPhrase: 'hey eva',
        trailingCommand: 'check deployment status',
        transcript: 'Hey Eva check deployment status',
        timestamp: 123456,
        source: 'android-foreground-service',
      })
    )

    const received: NativeWakeEvent[] = []
    const unsub = onAndroidWakeDetected((ev) => received.push(ev), androidWin)

    // Buffered event should replay immediately upon subscribing
    assert.equal(received.length, 1)
    assert.equal(received[0].matchedPhrase, 'hey eva')
    assert.equal(received[0].trailingCommand, 'check deployment status')

    // Subsequent live wake event delivers immediately
    androidWin.__nexusAndroidOnWakeDetected?.(
      JSON.stringify({
        matchedPhrase: 'eva',
        trailingCommand: '',
        transcript: 'Eva',
        timestamp: 123999,
      })
    )
    unsub()

    assert.equal(received.length, 2)
    assert.equal(received[1].matchedPhrase, 'eva')
    assert.deepEqual(haptics, ['success', 'success'])
  })

  it('unwinds Android Back handlers in descending priority and LIFO order', () => {
    const order: string[] = []
    const unsubLow = registerBackHandler(() => {
      order.push('low')
      return true
    }, 10)
    const unsubHigh1 = registerBackHandler(() => {
      order.push('high-pass')
      return false
    }, 80)
    const unsubHigh2 = registerBackHandler(() => {
      order.push('high-sheet')
      return true
    }, 80)

    assert.equal(dispatchAndroidBack(), true)
    assert.deepEqual(order, ['high-sheet'])

    unsubHigh2()
    order.length = 0
    assert.equal(dispatchAndroidBack(), true)
    assert.deepEqual(order, ['high-pass', 'low'])

    unsubHigh1()
    unsubLow()
    assert.equal(dispatchAndroidBack(), false)
  })
})
