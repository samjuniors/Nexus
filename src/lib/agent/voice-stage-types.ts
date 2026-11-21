/**
 * Client-safe types and pure helpers for Eva's autonomous Voice Stage Presenter.
 * Zero server-only imports so this module can be shared cleanly between
 * server (`live-session.ts`, `control-bus.ts`, `tools.ts`) and client UI components.
 */

import type { ToolResultDisplay } from '@/lib/agent/types'

export type VoiceStageCardKind =
  | 'date_time'
  | 'image'
  | 'gallery'
  | 'weather'
  | 'card'
  | 'list'
  | 'code'

export interface VoiceStageHighlight {
  label: string
  value: string
}

export interface VoiceStageListItem {
  text: string
  subtext?: string
  checked?: boolean
}

export interface VoiceStageAction {
  label: string
  tab?: string
  splitMode?: string
  url?: string
}

export interface VoiceStageWeatherForecast {
  date: string
  condition: string
  min: number
  max: number
}

export interface VoiceStageCardBase {
  id: string
  kind: VoiceStageCardKind
  title: string
  subtitle?: string
  sourceTool?: string
  pinned?: boolean
  createdAt: string
}

export interface VoiceStageDateTimeCard extends VoiceStageCardBase {
  kind: 'date_time'
  isoDate: string
  dateLabel: string
  timeLabel: string
  weekday: string
  timezone?: string
  note?: string
}

export interface VoiceStageImageCard extends VoiceStageCardBase {
  kind: 'image'
  url: string
  caption?: string
  prompt?: string
}

export interface VoiceStageGalleryCard extends VoiceStageCardBase {
  kind: 'gallery'
  items: { url: string; caption?: string }[]
}

export interface VoiceStageWeatherCard extends VoiceStageCardBase {
  kind: 'weather'
  place: string
  temperature?: number
  feelsLike?: number
  condition: string
  humidity?: number
  windKmh?: number
  forecast: VoiceStageWeatherForecast[]
}

export interface VoiceStageRichCard extends VoiceStageCardBase {
  kind: 'card'
  headline?: string
  body: string
  highlights?: VoiceStageHighlight[]
  actions?: VoiceStageAction[]
}

export interface VoiceStageListCard extends VoiceStageCardBase {
  kind: 'list'
  items: VoiceStageListItem[]
  note?: string
}

export interface VoiceStageCodeCard extends VoiceStageCardBase {
  kind: 'code'
  language?: string
  code: string
  output?: string
  ok?: boolean
}

export type VoiceStageCard =
  | VoiceStageDateTimeCard
  | VoiceStageImageCard
  | VoiceStageGalleryCard
  | VoiceStageWeatherCard
  | VoiceStageRichCard
  | VoiceStageListCard
  | VoiceStageCodeCard

function makeCardId(prefix = 'vstage'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Formats a real Date into a structured `date_time` VoiceStageCard.
 */
export function createDateTimeVoiceCard(opts?: {
  now?: Date
  title?: string
  subtitle?: string
  timezone?: string
  note?: string
  sourceTool?: string
}): VoiceStageDateTimeCard {
  const now = opts?.now ?? new Date()
  const tz = opts?.timezone?.trim() || undefined

  let dateLabel: string
  let timeLabel: string
  let weekday: string
  let resolvedTz = tz ?? 'Local'

  try {
    const tzOpts = tz ? { timeZone: tz } : {}
    weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', ...tzOpts }).format(now)
    dateLabel = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...tzOpts,
    }).format(now)
    timeLabel = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      ...tzOpts,
    }).format(now)
    if (!tz) {
      resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    }
  } catch {
    weekday = now.toUTCString().split(',')[0] || 'Today'
    dateLabel = now.toISOString().slice(0, 10)
    timeLabel = now.toISOString().slice(11, 19) + ' UTC'
    resolvedTz = 'UTC'
  }

  return {
    id: makeCardId('dt'),
    kind: 'date_time',
    title: opts?.title?.trim() || 'Date & Time',
    subtitle: opts?.subtitle?.trim() || resolvedTz,
    sourceTool: opts?.sourceTool ?? 'present_visual',
    isoDate: now.toISOString(),
    dateLabel,
    timeLabel,
    weekday,
    timezone: resolvedTz,
    note: opts?.note?.trim() || undefined,
    createdAt: now.toISOString(),
  }
}

/**
 * Converts a tool execution result (`generate_image`, `search_images`, `create_chart`,
 * `weather_lookup`, `time.get_datetime`, `run_code`, etc.) into a VoiceStageCard so
 * visuals automatically appear cleanly over the Voice Focus screen.
 */
export function buildVoiceStageCardFromToolResult(
  toolSlug: string,
  args: Record<string, unknown>,
  result: { ok: boolean; summary: string; raw: string; display?: ToolResultDisplay | null }
): VoiceStageCard | null {
  if (!result.ok) return null
  const nowIso = new Date().toISOString()
  const display = result.display

  if (toolSlug === 'time.get_datetime') {
    const tz = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : undefined
    return createDateTimeVoiceCard({
      title: 'Current Date & Time',
      timezone: tz,
      sourceTool: toolSlug,
    })
  }

  if (display?.kind === 'image' && typeof display.url === 'string' && display.url.trim()) {
    const promptText = display.prompt || String(args.prompt ?? args.title ?? '').trim()
    const isChart = toolSlug === 'create_chart'
    return {
      id: makeCardId('img'),
      kind: 'image',
      title: isChart
        ? String(args.title ?? 'Generated Chart').trim() || 'Generated Chart'
        : 'Generated Visual',
      subtitle: promptText ? promptText.slice(0, 96) : undefined,
      sourceTool: toolSlug,
      url: display.url,
      caption: result.summary,
      prompt: promptText || undefined,
      createdAt: nowIso,
    }
  }

  if (display?.kind === 'images' && Array.isArray(display.items) && display.items.length > 0) {
    const validItems = display.items.filter((i) => typeof i.url === 'string' && i.url.trim().length > 0)
    if (validItems.length === 0) return null
    if (validItems.length === 1) {
      return {
        id: makeCardId('img'),
        kind: 'image',
        title: String(args.query ?? 'Image Result').trim() || 'Image Result',
        subtitle: validItems[0].caption,
        sourceTool: toolSlug,
        url: validItems[0].url,
        caption: validItems[0].caption,
        createdAt: nowIso,
      }
    }
    return {
      id: makeCardId('gal'),
      kind: 'gallery',
      title: String(args.query ?? 'Images').trim() || 'Images',
      subtitle: `${validItems.length} visuals`,
      sourceTool: toolSlug,
      items: validItems.slice(0, 8),
      createdAt: nowIso,
    }
  }

  if (display?.kind === 'weather') {
    return {
      id: makeCardId('wx'),
      kind: 'weather',
      title: display.place || 'Weather',
      subtitle: display.condition,
      sourceTool: toolSlug,
      place: display.place,
      temperature: display.temperature,
      feelsLike: display.feelsLike,
      condition: display.condition,
      humidity: display.humidity,
      windKmh: display.windKmh,
      forecast: Array.isArray(display.forecast) ? display.forecast.slice(0, 5) : [],
      createdAt: nowIso,
    }
  }

  if (display?.kind === 'code' && (display.code || display.output)) {
    return {
      id: makeCardId('code'),
      kind: 'code',
      title: toolSlug === 'terminal_exec' ? 'Terminal Output' : 'Code Execution',
      subtitle: display.ok ? 'Succeeded' : 'Exited with error',
      sourceTool: toolSlug,
      language: toolSlug === 'run_code' ? 'javascript' : 'shell',
      code: display.code,
      output: display.output,
      ok: display.ok,
      createdAt: nowIso,
    }
  }

  return null
}

/**
 * Normalizes Gemini Live `present_visual` function call arguments into a concrete VoiceStageCard.
 */
export function buildVoiceStageCardFromPresentVisualArgs(
  args: Record<string, unknown>
): VoiceStageCard {
  const now = new Date()
  const nowIso = now.toISOString()
  const rawKind = String(args.kind ?? 'card').trim().toLowerCase()
  const title = String(args.title ?? '').trim()
  const subtitle = typeof args.subtitle === 'string' && args.subtitle.trim() ? args.subtitle.trim() : undefined

  if (rawKind === 'date_time' || rawKind === 'date' || rawKind === 'time' || rawKind === 'clock') {
    return createDateTimeVoiceCard({
      now,
      title: title || 'Today',
      subtitle,
      timezone: typeof args.timezone === 'string' ? args.timezone : undefined,
      note: typeof args.body === 'string' ? args.body : undefined,
      sourceTool: 'present_visual',
    })
  }

  if (rawKind === 'image') {
    const imageUrl = String(args.imageUrl ?? args.url ?? '').trim()
    if (imageUrl) {
      return {
        id: makeCardId('img'),
        kind: 'image',
        title: title || 'Visual',
        subtitle,
        sourceTool: 'present_visual',
        url: imageUrl,
        caption: typeof args.body === 'string' && args.body.trim() ? args.body.trim() : undefined,
        createdAt: nowIso,
      }
    }
  }

  if (rawKind === 'gallery') {
    const rawItems = Array.isArray(args.items) ? args.items : []
    const items = rawItems
      .map((item) => {
        if (typeof item === 'string') return { url: item.trim() }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          const url = String(obj.url ?? obj.imageUrl ?? '').trim()
          const caption = typeof obj.caption === 'string' ? obj.caption.trim() : typeof obj.text === 'string' ? obj.text.trim() : undefined
          return url ? { url, caption } : null
        }
        return null
      })
      .filter((x): x is { url: string; caption?: string } => Boolean(x && x.url))
    if (items.length > 0) {
      return {
        id: makeCardId('gal'),
        kind: 'gallery',
        title: title || 'Gallery',
        subtitle: subtitle ?? `${items.length} visuals`,
        sourceTool: 'present_visual',
        items: items.slice(0, 8),
        createdAt: nowIso,
      }
    }
  }

  if (rawKind === 'list') {
    const rawItems = Array.isArray(args.items) ? args.items : []
    const items: VoiceStageListItem[] = rawItems
      .map((item) => {
        if (typeof item === 'string') return { text: item.trim() }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          const text = String(obj.text ?? obj.label ?? obj.title ?? '').trim()
          const subtext = typeof obj.subtext === 'string' ? obj.subtext.trim() : typeof obj.value === 'string' ? obj.value.trim() : undefined
          const checked = typeof obj.checked === 'boolean' ? obj.checked : undefined
          return text ? { text, subtext, checked } : null
        }
        return null
      })
      .filter((x): x is VoiceStageListItem => Boolean(x && x.text))

    return {
      id: makeCardId('list'),
      kind: 'list',
      title: title || 'List',
      subtitle,
      sourceTool: 'present_visual',
      items: items.length > 0 ? items : [{ text: String(args.body ?? 'No items provided').trim() || 'Item' }],
      note: typeof args.body === 'string' && args.body.trim() && items.length > 0 ? args.body.trim() : undefined,
      createdAt: nowIso,
    }
  }

  if (rawKind === 'code') {
    return {
      id: makeCardId('code'),
      kind: 'code',
      title: title || 'Code',
      subtitle,
      sourceTool: 'present_visual',
      language: typeof args.language === 'string' && args.language.trim() ? args.language.trim() : 'text',
      code: String(args.code ?? args.body ?? '').trim(),
      output: typeof args.output === 'string' && args.output.trim() ? args.output.trim() : undefined,
      ok: true,
      createdAt: nowIso,
    }
  }

  // Default: structured rich card
  const rawHighlights = Array.isArray(args.highlights) ? args.highlights : []
  const highlights: VoiceStageHighlight[] = rawHighlights
    .map((h) => {
      if (h && typeof h === 'object') {
        const obj = h as Record<string, unknown>
        const label = String(obj.label ?? '').trim()
        const value = String(obj.value ?? '').trim()
        return label && value ? { label, value } : null
      }
      return null
    })
    .filter((x): x is VoiceStageHighlight => Boolean(x))

  return {
    id: makeCardId('card'),
    kind: 'card',
    title: title || 'Eva Visual',
    subtitle,
    sourceTool: 'present_visual',
    headline: typeof args.headline === 'string' && args.headline.trim() ? args.headline.trim() : undefined,
    body: String(args.body ?? '').trim(),
    highlights: highlights.length > 0 ? highlights : undefined,
    createdAt: nowIso,
  }
}

const DISMISS_PATTERNS: RegExp[] = [
  /^(?:ok(?:ay)?|thanks?(?:\s+you)?|cool|great|got\s+it|alright|eva)?[\s,.!]*(?:please\s+)?(?:close|hide|dismiss|clear|remove|exit)\s+(?:it|this|that|(?:the|that|this)\s+(?:card|popup|pop-up|image|photo|picture|visual|date|clock|weather|screen|preview|overlay))[\s,.!]*$/i,
  /^(?:close|dismiss|hide|clear\s+(?:the\s+)?screen)[\s,.!]*$/i,
  /^(?:you\s+can\s+)?(?:close|hide|dismiss)\s+(?:it|that|this)\s*(?:now)?[\s,.!]*$/i,
  /^(?:all\s+done|i'?m\s+done|that'?s\s+all)[\s,.!]*(?:close|hide|dismiss)?[\s,.!]*$/i,
]

/**
 * Detects concise spoken user commands asking Eva to dismiss the active voice visual card.
 */
export function isVoiceDismissIntent(transcript: string): boolean {
  const clean = transcript.replace(/\s+/g, ' ').trim()
  if (!clean || clean.length > 90) return false
  return DISMISS_PATTERNS.some((re) => re.test(clean))
}

const KEEP_OR_FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(?:keep|pin|leave|hold)\s+(?:it|that|this)\b/i,
  /\b(?:zoom|enlarge|expand|bigger|full\s*screen|download|save)\b/i,
  /\b(?:what\s+does\s+(?:it|that|this)\s+say|explain\s+(?:it|that|this)|tell\s+me\s+more\s+about\s+(?:it|that|this))\b/i,
  /^(?:thanks?|thank\s+you|nice|cool|awesome|wow|great|perfect|ok(?:ay)?|yeah|yes|hmm|uh\s*huh)[\s,.!]*$/i,
]

/**
 * Determines whether a new spoken user turn represents a topic change that should
 * cleanly dismiss an unpinned VoiceStageCard so Coucou returns to center stage.
 */
export function isTopicChangeTurn(userTranscript: string, card: VoiceStageCard | null): boolean {
  if (!card || card.pinned) return false
  const clean = userTranscript.replace(/\s+/g, ' ').trim()
  if (!clean) return false
  // Short filler acknowledgements shouldn't immediately yank the card away
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length < 3) return false
  if (KEEP_OR_FOLLOWUP_PATTERNS.some((re) => re.test(clean))) return false

  // If the user explicitly references the current card's domain, keep it open for Eva to update or keep
  if (card.kind === 'date_time' && /\b(date|time|today|clock|timezone|calendar|day)\b/i.test(clean)) {
    return false
  }
  if ((card.kind === 'image' || card.kind === 'gallery') && /\b(image|photo|picture|drawing|illustration|poster|color|style|regenerate|edit)\b/i.test(clean)) {
    return false
  }
  if (card.kind === 'weather' && /\b(weather|temperature|forecast|rain|wind|humidity|tomorrow)\b/i.test(clean)) {
    return false
  }
  return true
}
