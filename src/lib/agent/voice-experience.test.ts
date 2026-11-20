import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VOICE_VISUALIZER_OPTIONS,
  computeVisualizerIntensity,
  isVoiceVisualizerStyle,
} from './voice-visualizer'
import {
  computeSubtitleFadeMs,
  extractActiveSubtitleCue,
  splitIntoSubtitlePhrases,
} from './subtitle-engine'
import {
  analyzeCameraFrameGrid,
  computeCompanionOrientation,
  createGazeTrackerState,
  detectFounderGesture,
  smoothGazePoint,
  stepGazeTracker,
} from './camera-gaze'

describe('voice-visualizer', () => {
  it('exposes all 5 visualizer styles and validates ids', () => {
    const ids = VOICE_VISUALIZER_OPTIONS.map((o) => o.id)
    assert.deepEqual(ids, ['halo', 'ripples', 'waveform', 'aurora', 'minimal'])
    for (const id of ids) {
      assert.equal(isVoiceVisualizerStyle(id), true)
    }
    assert.equal(isVoiceVisualizerStyle('invalid'), false)
  })

  it('scales visualizer intensity calmly from sleep -> idle -> listening -> speaking', () => {
    const sleep = computeVisualizerIntensity({
      voiceActive: false,
      isSpeaking: false,
      isUserSpeaking: false,
      speakingLevel: 0,
      micLevel: 0,
      sleepMode: true,
    })
    const idle = computeVisualizerIntensity({
      voiceActive: false,
      isSpeaking: false,
      isUserSpeaking: false,
      speakingLevel: 0,
      micLevel: 0,
    })
    const listening = computeVisualizerIntensity({
      voiceActive: true,
      isSpeaking: false,
      isUserSpeaking: false,
      speakingLevel: 0,
      micLevel: 0,
    })
    const speaking = computeVisualizerIntensity({
      voiceActive: true,
      isSpeaking: true,
      isUserSpeaking: false,
      speakingLevel: 0.72,
      micLevel: 0,
    })

    assert.ok(sleep < idle)
    assert.ok(idle < listening)
    assert.ok(listening < speaking)
    assert.ok(speaking <= 1)
  })
})

describe('subtitle-engine', () => {
  it('splits multi-sentence speech so earlier sentences clear when Eva moves on', () => {
    const step1 = extractActiveSubtitleCue('How are you?')
    assert.equal(step1.current, 'How are you?')
    assert.equal(step1.previous, null)
    assert.equal(step1.phraseIndex, 0)

    const step2 = extractActiveSubtitleCue("How are you? I'm Eva.")
    assert.equal(step2.current, "I'm Eva.")
    assert.equal(step2.previous, 'How are you?')
    assert.equal(step2.phraseIndex, 1)
    assert.equal(step2.totalPhrases, 2)
  })

  it('chunks long sentences on clause boundaries and word limits', () => {
    const longText =
      'I checked your project repository, verified the mobile layout, and everything is ready to ship whenever you say the word.'
    const phrases = splitIntoSubtitlePhrases(longText, 55)
    assert.ok(phrases.length >= 2)
    for (const phrase of phrases) {
      assert.ok(phrase.length <= 55, `Expected <= 55 chars, got: "${phrase}"`)
    }
  })

  it('returns empty cue for blank transcript and sensible fade durations', () => {
    const empty = extractActiveSubtitleCue('   ')
    assert.equal(empty.current, '')
    assert.equal(empty.totalPhrases, 0)

    const shortIdle = computeSubtitleFadeMs('Hi there.', false)
    const speakingLong = computeSubtitleFadeMs(
      'I can see you clearly through the camera and I am ready for your next task.',
      true
    )
    assert.ok(shortIdle >= 2400)
    assert.ok(speakingLong > shortIdle)
  })
})

interface PatchRect {
  x0: number
  y0: number
  x1: number
  y1: number
  rgb: [number, number, number]
}

function makeFrame(
  w: number,
  h: number,
  bg: [number, number, number],
  patches: PatchRect[] = []
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      let rgb = bg
      for (const patch of patches) {
        if (x >= patch.x0 && x < patch.x1 && y >= patch.y0 && y < patch.y1) {
          rgb = patch.rgb
        }
      }
      buf[idx] = rgb[0]
      buf[idx + 1] = rgb[1]
      buf[idx + 2] = rgb[2]
      buf[idx + 3] = 255
    }
  }
  return buf
}

describe('camera-gaze (Face-First Hybrid Gaze Engine)', () => {
  it('extracts YCbCr face bounding box and mirrors horizontal coordinates for selfie eye contact', () => {
    const w = 48
    const h = 36
    // Place face cluster on raw RIGHT side (x = 32..42) -> mirrored LEFT (-x)
    const frame = makeFrame(w, h, [18, 22, 30], [
      { x0: 32, y0: 8, x1: 42, y1: 22, rgb: [210, 155, 125] },
    ])

    const mirrored = analyzeCameraFrameGrid(frame, w, h, null, true)
    assert.ok(mirrored.faceBox !== null)
    assert.ok(mirrored.faceCenter !== null)
    assert.equal(mirrored.detectorSource, 'ycbcr-face')
    assert.ok(
      mirrored.faceCenter.x < -0.35,
      `Expected mirrored left face gaze < -0.35, got ${mirrored.faceCenter.x}`
    )

    const unmirrored = analyzeCameraFrameGrid(frame, w, h, null, false)
    assert.ok(unmirrored.faceCenter !== null)
    assert.ok(
      unmirrored.faceCenter.x > 0.35,
      `Expected unmirrored right face gaze > 0.35, got ${unmirrored.faceCenter.x}`
    )
  })

  it('fuses native browser FaceDetector coordinates directly when provided', () => {
    const w = 48
    const h = 36
    const blank = makeFrame(w, h, [16, 18, 24])
    const analysis = analyzeCameraFrameGrid(blank, w, h, null, true, {
      x: 0.7,
      y: 0.2,
      width: 0.2,
      height: 0.3,
    })
    assert.equal(analysis.detectorSource, 'native-face')
    assert.ok(analysis.faceCenter !== null)
    // Raw x 0.7..0.9 mirrored -> display x 0.1..0.3 -> center 0.2 -> -0.6
    assert.ok(analysis.faceCenter.x < -0.5, `Expected mirrored x < -0.5, got ${analysis.faceCenter.x}`)
    assert.ok(analysis.faceConfidence >= 0.95)
  })

  it('in hybrid mode locks onto face, briefly glances at salient outside-face hand motion, then returns to face', () => {
    const w = 48
    const h = 36
    const facePatch: PatchRect = { x0: 19, y0: 9, x1: 29, y1: 23, rgb: [212, 156, 126] }
    const state = createGazeTrackerState()

    // Frame 1: centered stationary face -> locks eye contact on face
    const f1 = makeFrame(w, h, [18, 20, 26], [facePatch])
    const r1 = stepGazeTracker(state, f1, w, h, 1000, { mirrorX: true, mode: 'hybrid' })
    assert.equal(r1.gaze.target, 'face')
    assert.equal(r1.gaze.present, true)
    assert.ok(Math.abs(r1.gaze.x) < 0.25)

    // Frame 2: bright moving object/hand appears far left in raw sensor (mirrored right +x) outside face box
    const f2 = makeFrame(w, h, [18, 20, 26], [
      facePatch,
      { x0: 1, y0: 10, x1: 14, y1: 28, rgb: [240, 240, 245] },
    ])
    const r2 = stepGazeTracker(state, f2, w, h, 1100, { mirrorX: true, mode: 'hybrid' })
    assert.equal(r2.gaze.target, 'hand')
    assert.ok(r2.gaze.x > 0.18, `Expected glance toward right hand (+x), got ${r2.gaze.x}`)

    // Frame 3 (after glance window expires, hand stops moving): smoothly returns to face eye contact
    const r3 = stepGazeTracker(state, f2, w, h, 2600, { mirrorX: true, mode: 'hybrid' })
    assert.equal(r3.gaze.target, 'face')
  })

  it('in strict face mode ignores outside-face moving object to keep unwavering eye contact', () => {
    const w = 48
    const h = 36
    const facePatch: PatchRect = { x0: 19, y0: 9, x1: 29, y1: 23, rgb: [212, 156, 126] }
    const state = createGazeTrackerState()

    const f1 = makeFrame(w, h, [18, 20, 26], [facePatch])
    stepGazeTracker(state, f1, w, h, 1000, { mirrorX: true, mode: 'face' })

    const f2 = makeFrame(w, h, [18, 20, 26], [
      facePatch,
      { x0: 1, y0: 10, x1: 14, y1: 28, rgb: [240, 240, 245] },
    ])
    const r2 = stepGazeTracker(state, f2, w, h, 1100, { mirrorX: true, mode: 'face' })
    assert.equal(r2.gaze.target, 'face')
    assert.ok(Math.abs(r2.gaze.x) < 0.25)
  })

  it('computes bounded 3D head tilt and attentive eye scale orientation from gaze & proximity', () => {
    const smoothed = smoothGazePoint({ x: 0, y: 0 }, { x: 1, y: -0.5 }, 0.3)
    assert.ok(smoothed.x > 0.3 && smoothed.x < 0.7)

    const orient = computeCompanionOrientation({
      x: 0.85,
      y: -0.2,
      proximity: 0.75,
      target: 'face',
    })
    assert.ok(orient.headTilt > 0.05 && orient.headTilt <= 0.16)
    assert.ok(orient.eyeScale > 1.03 && orient.eyeScale <= 1.1)
  })

  it('detects wave and nod Founder gestures with cooldown protection', () => {
    const waveState = createGazeTrackerState()
    waveState.recentDx = [0.12, -0.14, 0.13, -0.12, 0.11]
    waveState.recentDy = [0.01, -0.01, 0.01, 0.0, -0.01]
    waveState.recentEnergy = [0.32, 0.35, 0.3, 0.34, 0.31]

    const wave = detectFounderGesture(waveState, 5000)
    assert.equal(wave?.kind, 'wave')

    const duringCooldown = detectFounderGesture(waveState, 6000)
    assert.equal(duringCooldown, null)

    const nodState = createGazeTrackerState()
    nodState.recentDx = [0.01, -0.01, 0.0, 0.01, -0.01]
    nodState.recentDy = [0.1, -0.11, 0.1, -0.09, 0.08]
    nodState.recentEnergy = [0.24, 0.26, 0.25, 0.27, 0.24]

    const nod = detectFounderGesture(nodState, 5000)
    assert.equal(nod?.kind, 'nod')
  })
})
