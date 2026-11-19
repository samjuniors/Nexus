import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyViewport,
  isCompactTouchTier,
  shouldStartInVoiceAgentMode,
} from './responsive-layout'
import {
  mobileManager,
  planAndroidAutopilotSteps,
  resolveMobileAppId,
  resolveQuickSettingKey,
} from './mobile-manager'
import { buildAndroidBridgeScript } from './device-bridge'

describe('responsive viewport & voice-first landing logic', () => {
  it('classifies mobile, tablet, and desktop widths accurately', () => {
    assert.equal(classifyViewport(390), 'mobile')
    assert.equal(classifyViewport(767), 'mobile')
    assert.equal(classifyViewport(768), 'tablet')
    assert.equal(classifyViewport(820), 'tablet')
    assert.equal(classifyViewport(1023), 'tablet')
    assert.equal(classifyViewport(1024), 'desktop')
    assert.equal(classifyViewport(1440), 'desktop')
  })

  it('marks mobile and tablet as compact touch tiers', () => {
    assert.equal(isCompactTouchTier('mobile'), true)
    assert.equal(isCompactTouchTier('tablet'), true)
    assert.equal(isCompactTouchTier('desktop'), false)
  })

  it('launches in Voice Agent mode on mobile & tablet by default unless opted out', () => {
    assert.equal(shouldStartInVoiceAgentMode({ width: 390, mobileVoiceFirstEnabled: true }), true)
    assert.equal(shouldStartInVoiceAgentMode({ width: 820, mobileVoiceFirstEnabled: true }), true)
    assert.equal(shouldStartInVoiceAgentMode({ width: 1440, mobileVoiceFirstEnabled: true }), false)
    assert.equal(shouldStartInVoiceAgentMode({ width: 390, mobileVoiceFirstEnabled: false }), false)
    assert.equal(
      shouldStartInVoiceAgentMode({
        width: 390,
        mobileVoiceFirstEnabled: true,
        queryView: 'workspace',
      }),
      false
    )
    assert.equal(
      shouldStartInVoiceAgentMode({
        width: 1440,
        mobileVoiceFirstEnabled: false,
        queryView: 'voice',
      }),
      true
    )
  })
})

describe('Android & Mobile Takeover manager and autopilot planner', () => {
  it('resolves app aliases and quick setting keys reliably', () => {
    assert.equal(resolveMobileAppId('Settings'), 'settings')
    assert.equal(resolveMobileAppId('SMS'), 'messages')
    assert.equal(resolveMobileAppId('dialer'), 'phone')
    assert.equal(resolveMobileAppId('browser'), 'chrome')
    assert.equal(resolveQuickSettingKey('Do Not Disturb'), 'dnd')
    assert.equal(resolveQuickSettingKey('Wi-Fi'), 'wifi')
    assert.equal(resolveQuickSettingKey('torch'), 'flashlight')
  })

  it('plans multi-step Android autopilot flows for settings, messaging, notifications, and Chrome', () => {
    const dndSteps = planAndroidAutopilotSteps('Open Settings and enable Do Not Disturb')
    assert.equal(dndSteps.some((s) => s.action === 'open_app' && s.app === 'settings'), true)
    assert.equal(dndSteps.some((s) => s.action === 'toggle_setting' && s.setting === 'dnd' && s.enabled === true), true)

    const smsSteps = planAndroidAutopilotSteps('Text Alex saying On my way in 5 minutes')
    assert.equal(smsSteps.some((s) => s.action === 'open_app' && s.app === 'messages'), true)
    assert.equal(smsSteps.some((s) => s.action === 'type' && s.text?.includes('On my way')), true)

    const chromeSteps = planAndroidAutopilotSteps('Open Chrome and search weather in Tokyo')
    assert.equal(chromeSteps.some((s) => s.action === 'open_url' && s.url?.includes('Tokyo')), true)
  })

  it('executes Android actions on the live interactive device and updates frame state', async () => {
    const reset = await mobileManager.execute({ action: 'reset' })
    assert.equal(reset.ok, true)
    assert.equal(reset.frame.currentApp, 'home')

    const dnd = await mobileManager.execute({
      action: 'autopilot',
      goal: 'Open Settings and enable Do Not Disturb',
    })
    assert.equal(dnd.ok, true)
    assert.equal(dnd.frame.currentApp, 'settings')
    assert.equal(dnd.frame.quickSettings.dnd, true)
    assert.equal(dnd.frame.width, 1080)
    assert.equal(dnd.frame.height, 2400)

    const shade = await mobileManager.execute({ action: 'notifications', open: true })
    assert.equal(shade.frame.notificationShadeOpen, true)

    const msg = await mobileManager.execute({
      action: 'autopilot',
      goal: 'Text Alex saying Running 5 minutes late',
    })
    assert.equal(msg.ok, true)
    assert.equal(msg.frame.currentApp, 'messages')
    const alexThread = msg.frame.threads.find((t) => t.contact.includes('Alex'))
    assert.ok(alexThread)
    assert.equal(
      alexThread.messages.some((m) => m.from === 'me' && m.text.includes('Running 5 minutes late')),
      true
    )

    const tap = await mobileManager.execute({ action: 'tap', x: 540, y: 1200 })
    assert.equal(tap.ok, true)
    assert.equal(tap.frame.touchX, 540)
    assert.equal(tap.frame.touchY, 1200)

    const swipe = await mobileManager.execute({
      action: 'swipe',
      fromX: 540,
      fromY: 1800,
      toX: 540,
      toY: 600,
    })
    assert.equal(swipe.ok, true)
    assert.equal(swipe.frame.swipeVector?.toY, 600)
  })

  it('generates an executable ADB Android bridge script with mobile command handlers', () => {
    const script = buildAndroidBridgeScript('https://nexus.example.com')
    assert.equal(script.includes('wss://nexus.example.com/api/device-bridge'), true)
    assert.equal(script.includes('android_tap'), true)
    assert.equal(script.includes('android_swipe'), true)
    assert.equal(script.includes('android_open_app'), true)
    assert.equal(script.includes('android_screenshot'), true)
  })
})
