/**
 * Face-First Hybrid Gaze-Tracking Utility for Eva / Coucou Companion.
 *
 * Strategy ("Face vs. Moving Object"):
 * - Default ('hybrid'): Locks primary eye contact onto the user's FACE coordinates
 *   (via native browser FaceDetector when available, or pure-TS YCbCr skin-cluster
 *   face localization as universal fallback), and only briefly glances toward a
 *   salient moving hand/object OUTSIDE the face box before smoothly returning to
 *   eye contact.
 * - 'face': Strict face-only eye contact lock.
 * - 'motion': Follows the strongest moving object (hand/gesture) in frame.
 *
 * All coordinates are mirrored horizontally for front/selfie cameras so moving
 * to the user's left turns Eva's eyes and head smoothly toward the user's left.
 */

export type GazeTrackingMode = 'hybrid' | 'face' | 'motion'
export type GazeFocusTarget = 'face' | 'hand' | 'idle'
export type GazeDetectorSource = 'native-face' | 'ycbcr-face' | 'motion' | 'none'
export type FounderGestureKind = 'wave' | 'nod' | 'lean_in'

export const GAZE_MODE_STORAGE_KEY = 'nexus-gaze-tracking-mode'

export interface GazeModeOption {
  id: GazeTrackingMode
  label: string
  shortLabel: string
  description: string
}

export const GAZE_TRACKING_MODE_OPTIONS: readonly GazeModeOption[] = [
  {
    id: 'hybrid',
    label: 'Face + Hand',
    shortLabel: 'Auto',
    description: 'Locks eye contact on your face and briefly glances when you wave or show an object',
  },
  {
    id: 'face',
    label: 'Face Only',
    shortLabel: 'Face',
    description: 'Maintains steady eye contact strictly on your face coordinates',
  },
  {
    id: 'motion',
    label: 'Moving Object',
    shortLabel: 'Motion',
    description: 'Follows your moving hand or any active object in front of the camera',
  },
] as const

/** Normalized bounding box in display space (0..1, already mirrored if front camera) */
export interface NormalizedFaceBox {
  x: number
  y: number
  width: number
  height: number
}

/** External face bounding box in raw sensor coordinates (e.g. from native window.FaceDetector) */
export interface ExternalFaceRect {
  /** Normalized 0..1 raw sensor coordinates */
  x: number
  y: number
  width: number
  height: number
}

export interface FounderGazePoint {
  /** Horizontal look target in -1 (left) .. +1 (right) */
  x: number
  /** Vertical look target in -1 (up) .. +1 (down) */
  y: number
  /** Subtle organic head roll/tilt in radians (-0.16 .. +0.16) */
  headTilt: number
  /** Subtle attentive eye-contact scale factor (0.96 .. 1.09) */
  eyeScale: number
  /** Whether a live user face or tracked object is currently present */
  present: boolean
  /** 0..1 normalized motion energy */
  energy: number
  /** 0..1 estimated user proximity from face size (higher = closer to camera) */
  proximity: number
  /** 0..1 tracking confidence */
  confidence: number
  /** What Eva is currently looking at */
  target: GazeFocusTarget
  /** Which detection tier produced this lock */
  detectorSource: GazeDetectorSource
  /** Normalized display-space face bounding box (0..1) for optional PiP reticle */
  faceBox: NormalizedFaceBox | null
}

export interface FounderGestureEvent {
  kind: FounderGestureKind
  label: string
  ts: number
}

export interface CompanionOrientation {
  lookX: number
  lookY: number
  headTilt: number
  eyeScale: number
}

export interface GazeFrameAnalysis {
  faceCenter: { x: number; y: number } | null
  faceBox: NormalizedFaceBox | null
  faceConfidence: number
  proximity: number
  detectorSource: GazeDetectorSource
  handCenter: { x: number; y: number } | null
  handMotionEnergy: number
  totalMotionEnergy: number
  lumaGrid: Uint8Array
}

export interface GazeTrackerState {
  prevLuma: Uint8Array | null
  smoothedX: number
  smoothedY: number
  smoothedTilt: number
  smoothedEyeScale: number
  smoothedProximity: number
  lastPresenceTs: number
  lastFaceTs: number
  lastFaceBox: NormalizedFaceBox | null
  lastFaceCenter: { x: number; y: number } | null
  handGlanceUntilTs: number
  handGlanceCooldownUntilTs: number
  lastGestureTs: number
  recentDx: number[]
  recentDy: number[]
  recentEnergy: number[]
}

export function isGazeTrackingMode(value: unknown): value is GazeTrackingMode {
  return value === 'hybrid' || value === 'face' || value === 'motion'
}

export function readSavedGazeMode(): GazeTrackingMode {
  if (typeof window === 'undefined') return 'hybrid'
  try {
    const raw = window.localStorage.getItem(GAZE_MODE_STORAGE_KEY)
    if (isGazeTrackingMode(raw)) return raw
  } catch {
    /* ignore storage errors */
  }
  return 'hybrid'
}

export function persistGazeMode(mode: GazeTrackingMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GAZE_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore storage errors */
  }
}

export function createGazeTrackerState(): GazeTrackerState {
  return {
    prevLuma: null,
    smoothedX: 0,
    smoothedY: 0,
    smoothedTilt: 0,
    smoothedEyeScale: 1,
    smoothedProximity: 0,
    lastPresenceTs: 0,
    lastFaceTs: 0,
    lastFaceBox: null,
    lastFaceCenter: null,
    handGlanceUntilTs: 0,
    handGlanceCooldownUntilTs: 0,
    lastGestureTs: 0,
    recentDx: [],
    recentDy: [],
    recentEnergy: [],
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * Adaptive deadband + velocity smoothing: holds rock-steady eye contact when the
 * user barely moves, while snapping smoothly when the user leans or moves across frame.
 */
export function smoothGazePoint(
  current: { x: number; y: number },
  target: { x: number; y: number },
  alpha = 0.28
): { x: number; y: number } {
  const tx = clamp(target.x, -1, 1)
  const ty = clamp(target.y, -1, 1)
  const dist = Math.hypot(tx - current.x, ty - current.y)
  // Tiny micro-jitter deadband prevents trembling eyes during stationary eye contact
  if (dist < 0.014) {
    return { x: current.x, y: current.y }
  }
  const adaptiveAlpha = clamp(alpha + Math.min(0.24, dist * 0.35), 0.06, 0.72)
  return {
    x: clamp(current.x + (tx - current.x) * adaptiveAlpha, -1, 1),
    y: clamp(current.y + (ty - current.y) * adaptiveAlpha, -1, 1),
  }
}

/**
 * Converts detected user coordinates & proximity into natural 3D eye + head orientation
 * values for Coucou's BotEngine to simulate genuine eye contact.
 */
export function computeCompanionOrientation(input: {
  x: number
  y: number
  proximity: number
  target: GazeFocusTarget
}): CompanionOrientation {
  const lookX = clamp(input.x, -1, 1)
  const lookY = clamp(input.y, -1, 1)
  const prox = clamp(input.proximity, 0, 1)

  // Subtle curious head tilt leaning gently with horizontal position (stronger when glancing at a hand)
  const tiltGain = input.target === 'hand' ? 0.14 : 0.095
  const headTilt = clamp(lookX * tiltGain, -0.16, 0.16)

  // Attentive eye enlargement when user leans close in eye contact
  const eyeScale = clamp(1 + prox * 0.08 + (input.target === 'hand' ? 0.03 : 0), 0.96, 1.1)

  return { lookX, lookY, headTilt, eyeScale }
}

/**
 * Lighting-robust YCbCr skin chrominance classifier covering a wide range of
 * skin tones under warm indoor, cool monitor, and daylight lighting.
 */
function isSkinYCbCr(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  if (y < 42 || y > 246) return false
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  const chromaSpread = Math.max(r, g, b) - Math.min(r, g, b)
  return (
    cb >= 74 &&
    cb <= 129 &&
    cr >= 131 &&
    cr <= 178 &&
    chromaSpread >= 10 &&
    r >= g * 0.95 &&
    r > b * 0.95
  )
}

/**
 * Extracts the largest compact face-like connected skin cluster on the downsampled grid.
 * Prefers compact elliptical regions near upper/middle frame (typical face position)
 * over thin edges or background noise.
 */
function extractYCbCrFaceCluster(
  skinMask: Uint8Array,
  width: number,
  height: number,
  mirrorX: boolean
): { box: NormalizedFaceBox; center: { x: number; y: number }; confidence: number; proximity: number } | null {
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)

  let bestScore = 0
  let bestCluster: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    count: number
    sumX: number
    sumY: number
  } | null = null

  const minPixels = Math.max(5, Math.floor(total * 0.012))

  for (let idx = 0; idx < total; idx++) {
    if (!skinMask[idx] || visited[idx]) continue

    let head = 0
    let tail = 0
    queue[tail++] = idx
    visited[idx] = 1

    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    let count = 0
    let sumX = 0
    let sumY = 0

    while (head < tail) {
      const cur = queue[head++]
      const cx = cur % width
      const cy = (cur - cx) / width

      count++
      sumX += cx
      sumY += cy
      if (cx < minX) minX = cx
      if (cx > maxX) maxX = cx
      if (cy < minY) minY = cy
      if (cy > maxY) maxY = cy

      // 4-connected neighbors
      if (cx > 0) {
        const n = cur - 1
        if (skinMask[n] && !visited[n]) {
          visited[n] = 1
          queue[tail++] = n
        }
      }
      if (cx + 1 < width) {
        const n = cur + 1
        if (skinMask[n] && !visited[n]) {
          visited[n] = 1
          queue[tail++] = n
        }
      }
      if (cy > 0) {
        const n = cur - width
        if (skinMask[n] && !visited[n]) {
          visited[n] = 1
          queue[tail++] = n
        }
      }
      if (cy + 1 < height) {
        const n = cur + width
        if (skinMask[n] && !visited[n]) {
          visited[n] = 1
          queue[tail++] = n
        }
      }
    }

    if (count < minPixels) continue

    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const area = bw * bh
    const fillRatio = count / Math.max(1, area)
    const aspect = bw / Math.max(1, bh)

    // Faces are roughly oval (aspect 0.45..1.85) with decent fill density
    if (aspect < 0.35 || aspect > 2.3 || fillRatio < 0.22) continue

    const aspectBonus = 1 - Math.min(0.6, Math.abs(aspect - 0.82) * 0.45)
    const cyNorm = sumY / count / Math.max(1, height - 1)
    // Gentle upper-middle vertical prior (faces usually sit in upper 20%..75% of camera)
    const upperPrior = 1.15 - Math.min(0.4, Math.abs(cyNorm - 0.42))
    const score = count * fillRatio * aspectBonus * upperPrior

    if (score > bestScore) {
      bestScore = score
      bestCluster = { minX, maxX, minY, maxY, count, sumX, sumY }
    }
  }

  if (!bestCluster) return null

  const normX0 = bestCluster.minX / width
  const normW = (bestCluster.maxX - bestCluster.minX + 1) / width
  const normY0 = bestCluster.minY / height
  const normH = (bestCluster.maxY - bestCluster.minY + 1) / height

  const displayX = mirrorX ? clamp(1 - (normX0 + normW), 0, 1) : clamp(normX0, 0, 1)
  const box: NormalizedFaceBox = {
    x: displayX,
    y: clamp(normY0, 0, 1),
    width: clamp(normW, 0.04, 1),
    height: clamp(normH, 0.04, 1),
  }

  // Bias vertical gaze target slightly upward (42% down the face box) to align with the user's EYES
  const eyeCenterNormX = box.x + box.width * 0.5
  const eyeCenterNormY = box.y + box.height * 0.42
  const center = {
    x: clamp(eyeCenterNormX * 2 - 1, -1, 1),
    y: clamp(eyeCenterNormY * 2 - 1, -1, 1),
  }

  const areaFrac = (bestCluster.count / total) * 3.8
  const proximity = clamp(Math.sqrt(Math.max(0, areaFrac)), 0.1, 1)
  const confidence = clamp(bestCluster.count / Math.max(1, total * 0.06), 0.35, 0.94)

  return { box, center, confidence, proximity }
}

/**
 * Analyzes an RGBA camera frame grid for:
 * 1) Primary Face bounding box & eye-line center (native FaceDetector fusion OR YCbCr cluster)
 * 2) Secondary Moving Hand / Salient Object centroid outside the face box
 */
export function analyzeCameraFrameGrid(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  prevLuma: Uint8Array | null,
  mirrorX = true,
  externalFace?: ExternalFaceRect | null
): GazeFrameAnalysis {
  const totalPixels = width * height
  const lumaGrid = new Uint8Array(totalPixels)
  const skinMask = new Uint8Array(totalPixels)

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = py * width + px
      const off = idx * 4
      const r = rgba[off] ?? 0
      const g = rgba[off + 1] ?? 0
      const b = rgba[off + 2] ?? 0
      lumaGrid[idx] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      if (!externalFace && isSkinYCbCr(r, g, b)) {
        skinMask[idx] = 1
      }
    }
  }

  // 1. Resolve Primary Face Lock (prefer hardware-accelerated native FaceDetector if provided)
  let faceBox: NormalizedFaceBox | null = null
  let faceCenter: { x: number; y: number } | null = null
  let faceConfidence = 0
  let proximity = 0
  let detectorSource: GazeDetectorSource = 'none'

  if (externalFace && externalFace.width > 0.03 && externalFace.height > 0.03) {
    const displayX = mirrorX
      ? clamp(1 - (externalFace.x + externalFace.width), 0, 1)
      : clamp(externalFace.x, 0, 1)
    faceBox = {
      x: displayX,
      y: clamp(externalFace.y, 0, 1),
      width: clamp(externalFace.width, 0.04, 1),
      height: clamp(externalFace.height, 0.04, 1),
    }
    faceCenter = {
      x: clamp((faceBox.x + faceBox.width * 0.5) * 2 - 1, -1, 1),
      y: clamp((faceBox.y + faceBox.height * 0.42) * 2 - 1, -1, 1),
    }
    proximity = clamp(Math.sqrt(faceBox.width * faceBox.height * 4.5), 0.15, 1)
    faceConfidence = 0.98
    detectorSource = 'native-face'
  } else {
    const cluster = extractYCbCrFaceCluster(skinMask, width, height, mirrorX)
    if (cluster) {
      faceBox = cluster.box
      faceCenter = cluster.center
      faceConfidence = cluster.confidence
      proximity = cluster.proximity
      detectorSource = 'ycbcr-face'
    }
  }

  // 2. Measure Frame Motion (total + strictly outside the padded face bounding box for hand/object glances)
  let totalMotionWeight = 0
  let outsideMotionWeight = 0
  let outsideXSum = 0
  let outsideYSum = 0
  let outsideMotionPixels = 0

  let allMotionXSum = 0
  let allMotionYSum = 0
  let allMotionPixels = 0

  const padX = faceBox ? faceBox.width * 0.22 : 0
  const padY = faceBox ? faceBox.height * 0.22 : 0

  if (prevLuma && prevLuma.length === totalPixels) {
    for (let py = 0; py < height; py++) {
      const ny01 = py / Math.max(1, height - 1)
      const ny = ny01 * 2 - 1
      for (let px = 0; px < width; px++) {
        const idx = py * width + px
        const diff = Math.abs(lumaGrid[idx] - prevLuma[idx])
        if (diff <= 18) continue

        const w = Math.min(1, (diff - 18) / 68)
        const rawNx01 = px / Math.max(1, width - 1)
        const displayNx01 = mirrorX ? 1 - rawNx01 : rawNx01
        const nx = displayNx01 * 2 - 1

        totalMotionWeight += w
        allMotionXSum += nx * w
        allMotionYSum += ny * w
        allMotionPixels++

        const insideFace =
          faceBox !== null &&
          displayNx01 >= faceBox.x - padX &&
          displayNx01 <= faceBox.x + faceBox.width + padX &&
          ny01 >= faceBox.y - padY &&
          ny01 <= faceBox.y + faceBox.height + padY

        if (!insideFace) {
          outsideMotionWeight += w
          outsideXSum += nx * w
          outsideYSum += ny * w
          outsideMotionPixels++
        }
      }
    }
  }

  const totalMotionEnergy = totalPixels > 0 ? clamp(totalMotionWeight / (totalPixels * 0.13), 0, 1) : 0
  const handMotionEnergy = totalPixels > 0 ? clamp(outsideMotionWeight / (totalPixels * 0.08), 0, 1) : 0
  const minMotionCount = Math.max(4, Math.floor(totalPixels * 0.012))

  let handCenter: { x: number; y: number } | null = null
  if (outsideMotionPixels >= minMotionCount && outsideMotionWeight > 0) {
    handCenter = {
      x: clamp(outsideXSum / outsideMotionWeight, -1, 1),
      y: clamp(outsideYSum / outsideMotionWeight, -1, 1),
    }
  } else if (!faceBox && allMotionPixels >= minMotionCount && totalMotionWeight > 0) {
    handCenter = {
      x: clamp(allMotionXSum / totalMotionWeight, -1, 1),
      y: clamp(allMotionYSum / totalMotionWeight, -1, 1),
    }
  }

  return {
    faceCenter,
    faceBox,
    faceConfidence,
    proximity,
    detectorSource,
    handCenter,
    handMotionEnergy,
    totalMotionEnergy,
    lumaGrid,
  }
}

export interface StepGazeOptions {
  mirrorX?: boolean
  mode?: GazeTrackingMode
  externalFace?: ExternalFaceRect | null
}

/**
 * Stateful real-time tracker step:
 * - In 'hybrid' (best default): anchors eye contact onto the user's face, triggers
 *   a brief natural glance (~1.1s) when a hand/object moves strongly outside the face,
 *   and smoothly returns to face eye contact.
 * - In 'face': locks strictly onto the user's face coordinates.
 * - In 'motion': follows the strongest moving object / hand in frame.
 */
export function stepGazeTracker(
  state: GazeTrackerState,
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  nowMs: number,
  optionsOrMirror: boolean | StepGazeOptions = true
): { gaze: FounderGazePoint; gesture: FounderGestureEvent | null } {
  const opts: StepGazeOptions =
    typeof optionsOrMirror === 'boolean' ? { mirrorX: optionsOrMirror } : optionsOrMirror
  const mirrorX = opts.mirrorX ?? true
  const mode: GazeTrackingMode = opts.mode ?? 'hybrid'

  const analysis = analyzeCameraFrameGrid(
    rgba,
    width,
    height,
    state.prevLuma,
    mirrorX,
    opts.externalFace
  )
  state.prevLuma = analysis.lumaGrid

  const prevX = state.smoothedX
  const prevY = state.smoothedY

  if (analysis.faceCenter && analysis.faceBox) {
    state.lastFaceTs = nowMs
    state.lastFaceBox = analysis.faceBox
    state.lastFaceCenter = analysis.faceCenter
  }

  const faceFresh = analysis.faceCenter !== null || (state.lastFaceCenter !== null && nowMs - state.lastFaceTs < 750)
  const activeFaceCenter = analysis.faceCenter ?? (faceFresh ? state.lastFaceCenter : null)
  const activeFaceBox = analysis.faceBox ?? (faceFresh ? state.lastFaceBox : null)

  // Decide focus target based on mode
  let target: GazeFocusTarget = 'idle'
  let desiredPoint: { x: number; y: number } | null = null
  let detectorSource: GazeDetectorSource = analysis.detectorSource
  let confidence = analysis.faceConfidence

  if (mode === 'face') {
    if (activeFaceCenter) {
      target = 'face'
      desiredPoint = activeFaceCenter
    }
  } else if (mode === 'motion') {
    if (analysis.handCenter && analysis.totalMotionEnergy > 0.08) {
      target = 'hand'
      desiredPoint = analysis.handCenter
      detectorSource = 'motion'
      confidence = clamp(analysis.totalMotionEnergy, 0.35, 0.92)
    } else if (activeFaceCenter) {
      target = 'face'
      desiredPoint = activeFaceCenter
    }
  } else {
    // 'hybrid' — Face-First Eye Contact + Smart Salient Hand Glance
    const salientHandOutsideFace =
      analysis.handCenter !== null && analysis.handMotionEnergy >= 0.28

    if (salientHandOutsideFace && nowMs >= state.handGlanceCooldownUntilTs) {
      state.handGlanceUntilTs = nowMs + 1100
      state.handGlanceCooldownUntilTs = nowMs + 2800
    }

    const currentlyGlancingAtHand =
      nowMs < state.handGlanceUntilTs && analysis.handCenter !== null && analysis.handMotionEnergy >= 0.14

    if (currentlyGlancingAtHand && analysis.handCenter) {
      target = 'hand'
      // Blend 78% toward the moving hand while keeping subtle awareness of the user
      desiredPoint = activeFaceCenter
        ? {
            x: analysis.handCenter.x * 0.78 + activeFaceCenter.x * 0.22,
            y: analysis.handCenter.y * 0.78 + activeFaceCenter.y * 0.22,
          }
        : analysis.handCenter
      detectorSource = 'motion'
      confidence = clamp(analysis.handMotionEnergy + 0.2, 0.45, 0.95)
    } else if (activeFaceCenter) {
      target = 'face'
      desiredPoint = activeFaceCenter
    } else if (analysis.handCenter && analysis.totalMotionEnergy > 0.12) {
      // Fallback if user's face is temporarily out of frame but hand/person is moving
      target = 'hand'
      desiredPoint = analysis.handCenter
      detectorSource = 'motion'
      confidence = clamp(analysis.totalMotionEnergy, 0.3, 0.8)
    }
  }

  const isPresent = desiredPoint !== null

  if (desiredPoint) {
    state.lastPresenceTs = nowMs
    const alpha = target === 'hand' ? 0.38 : analysis.detectorSource === 'native-face' ? 0.3 : 0.24
    const next = smoothGazePoint({ x: state.smoothedX, y: state.smoothedY }, desiredPoint, alpha)
    state.smoothedX = next.x
    state.smoothedY = next.y
    state.smoothedProximity +=
      ((analysis.proximity || state.smoothedProximity) - state.smoothedProximity) * 0.2
  } else if (nowMs - state.lastPresenceTs > 2200) {
    // Gently drift back to neutral center when no one is in front of camera
    const next = smoothGazePoint({ x: state.smoothedX, y: state.smoothedY }, { x: 0, y: 0 }, 0.12)
    state.smoothedX = next.x
    state.smoothedY = next.y
    state.smoothedProximity *= 0.9
    state.lastFaceBox = null
    state.lastFaceCenter = null
  }

  const orientation = computeCompanionOrientation({
    x: state.smoothedX,
    y: state.smoothedY,
    proximity: state.smoothedProximity,
    target,
  })
  state.smoothedTilt += (orientation.headTilt - state.smoothedTilt) * 0.22
  state.smoothedEyeScale += (orientation.eyeScale - state.smoothedEyeScale) * 0.2

  const dx = state.smoothedX - prevX
  const dy = state.smoothedY - prevY

  state.recentDx.push(dx)
  state.recentDy.push(dy)
  state.recentEnergy.push(analysis.totalMotionEnergy)
  if (state.recentDx.length > 8) state.recentDx.shift()
  if (state.recentDy.length > 8) state.recentDy.shift()
  if (state.recentEnergy.length > 8) state.recentEnergy.shift()

  const gesture = detectFounderGesture(state, nowMs)

  return {
    gaze: {
      x: state.smoothedX,
      y: state.smoothedY,
      headTilt: state.smoothedTilt,
      eyeScale: state.smoothedEyeScale,
      present: isPresent || nowMs - state.lastPresenceTs <= 2200,
      energy: analysis.totalMotionEnergy,
      proximity: state.smoothedProximity,
      confidence,
      target,
      detectorSource,
      faceBox: activeFaceBox,
    },
    gesture,
  }
}

/**
 * Detects expressive Founder gestures (wave, nod, lean_in) from short motion history
 * with cooldown protection so Coucou reacts naturally without spamming.
 */
export function detectFounderGesture(
  state: GazeTrackerState,
  nowMs: number,
  cooldownMs = 3800
): FounderGestureEvent | null {
  if (nowMs - state.lastGestureTs < cooldownMs) return null
  if (state.recentEnergy.length < 5) return null

  const avgEnergy =
    state.recentEnergy.reduce((acc, v) => acc + v, 0) / state.recentEnergy.length

  let xReversals = 0
  let xTravel = 0
  let lastXSign = 0
  for (const dx of state.recentDx) {
    xTravel += Math.abs(dx)
    const sign = dx > 0.045 ? 1 : dx < -0.045 ? -1 : 0
    if (sign !== 0) {
      if (lastXSign !== 0 && sign !== lastXSign) xReversals++
      lastXSign = sign
    }
  }

  let yReversals = 0
  let yTravel = 0
  let lastYSign = 0
  for (const dy of state.recentDy) {
    yTravel += Math.abs(dy)
    const sign = dy > 0.04 ? 1 : dy < -0.04 ? -1 : 0
    if (sign !== 0) {
      if (lastYSign !== 0 && sign !== lastYSign) yReversals++
      lastYSign = sign
    }
  }

  if (xReversals >= 2 && xTravel > 0.32 && avgEnergy > 0.18) {
    state.lastGestureTs = nowMs
    return { kind: 'wave', label: 'Saw you wave', ts: nowMs }
  }

  if (yReversals >= 2 && yTravel > 0.24 && yTravel > xTravel * 1.15 && avgEnergy > 0.14) {
    state.lastGestureTs = nowMs
    return { kind: 'nod', label: 'Saw you nod', ts: nowMs }
  }

  const latestEnergy = state.recentEnergy[state.recentEnergy.length - 1] ?? 0
  const priorEnergy = state.recentEnergy[0] ?? 0
  if (
    latestEnergy > 0.58 &&
    latestEnergy - priorEnergy > 0.34 &&
    Math.abs(state.smoothedX) < 0.42
  ) {
    state.lastGestureTs = nowMs
    return { kind: 'lean_in', label: 'Looking right at you', ts: nowMs }
  }

  return null
}
