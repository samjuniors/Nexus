'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowUpRight,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  CloudSun,
  Code2,
  Copy,
  Download,
  Droplets,
  ImageOff,
  Images,
  ListChecks,
  Maximize2,
  Pin,
  PinOff,
  Sparkles,
  Wind,
  X,
} from 'lucide-react'
import type {
  VoiceStageCard,
  VoiceStageDateTimeCard,
  VoiceStageImageCard,
  VoiceStageGalleryCard,
  VoiceStageWeatherCard,
  VoiceStageRichCard,
  VoiceStageListCard,
  VoiceStageCodeCard,
} from '@/lib/agent/voice-stage-types'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import type { Tab } from '@/lib/agent/client'
import { triggerHaptic } from '@/lib/platform/android-bridge'
import { cn } from '@/lib/utils'

const VALID_TABS = new Set<Tab>([
  'agent',
  'org',
  'automations',
  'brain',
  'artifacts',
  'marketplace',
  'plugins',
  'skills',
  'tools',
  'mcps',
  'memory',
])

const VALID_SPLITS = new Set<SplitMode>([
  'reasoning',
  'self_heal',
  'browser',
  'terminal',
  'mobile',
  'identity',
  'permissions',
  'devices',
  'org',
  'artifacts',
  'tools',
  'automations',
  'brain',
  'google_workspace',
])

function formatLiveClock(now: Date, timezone?: string) {
  try {
    const tzOpts = timezone && timezone !== 'Local' ? { timeZone: timezone } : {}
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      ...tzOpts,
    }).format(now)
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', ...tzOpts }).format(now)
    const date = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...tzOpts,
    }).format(now)
    const tzShort = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', ...tzOpts })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value
    return { time, weekday, date, tzShort }
  } catch {
    return null
  }
}

function DateTimeBody({ card }: { card: VoiceStageDateTimeCard }) {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const live = formatLiveClock(now, card.timezone)
  const timeText = live?.time ?? card.timeLabel
  const weekdayText = live?.weekday ?? card.weekday
  const dateText = live?.date ?? card.dateLabel
  const tzDisplay = live?.tzShort
    ? `${card.timezone ?? 'Local'} · ${live.tzShort}`
    : (card.timezone ?? 'Local time')

  return (
    <div className="flex flex-col items-center px-5 py-6 text-center sm:px-7 sm:py-8">
      <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
        <Calendar className="h-3.5 w-3.5 text-sky-500" />
        <span>{weekdayText}</span>
      </div>

      <div
        data-voice-stage-clock="1"
        className="mt-2 font-sans text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl"
      >
        {timeText}
      </div>

      <div className="mt-2 text-base font-medium text-foreground/90 sm:text-lg">
        {dateText}
      </div>

      <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
        {tzDisplay}
      </div>

      {card.note && (
        <p className="mt-4 max-w-md border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
          {card.note}
        </p>
      )}
    </div>
  )
}

function SafeStageImage({
  src,
  alt,
  className,
  onClick,
}: {
  src: string
  alt: string
  className?: string
  onClick?: () => void
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (failed || !src) {
    return (
      <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-muted/40 px-4 text-center text-muted-foreground">
        <ImageOff className="h-6 w-6 opacity-60" />
        <p className="text-xs">Visual unavailable to preview directly</p>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onClick={onClick}
      className={cn(
        'w-full rounded-xl bg-muted/20 object-contain',
        onClick && 'cursor-zoom-in',
        className
      )}
    />
  )
}

function ImageBody({
  card,
  onInspect,
}: {
  card: VoiceStageImageCard
  onInspect: (url: string, caption?: string) => void
}) {
  return (
    <div className="p-3.5 sm:p-4">
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-muted/20">
        <SafeStageImage
          src={card.url}
          alt={card.prompt || card.title}
          className="max-h-[34dvh] w-full object-contain sm:max-h-[42dvh]"
          onClick={() => onInspect(card.url, card.caption || card.prompt || card.title)}
        />
        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onInspect(card.url, card.caption || card.prompt || card.title)}
            aria-label="Expand visual fullscreen"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <a
            href={card.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download visual"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {(card.caption || card.prompt) && (
        <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {card.caption || card.prompt}
        </p>
      )}
    </div>
  )
}

function GalleryBody({
  card,
  onInspect,
}: {
  card: VoiceStageGalleryCard
  onInspect: (url: string, caption?: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 p-3.5 sm:grid-cols-3 sm:p-4">
      {card.items.map((item, idx) => (
        <button
          key={`${card.id}-img-${idx}`}
          type="button"
          onClick={() => onInspect(item.url, item.caption || card.title)}
          className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted/20 text-left transition-transform active:scale-[0.98]"
        >
          <SafeStageImage
            src={item.url}
            alt={item.caption || `${card.title} ${idx + 1}`}
            className="aspect-square w-full object-cover"
          />
          {item.caption && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2 py-1.5">
              <p className="truncate text-[11px] font-medium text-white">{item.caption}</p>
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

function WeatherBody({ card }: { card: VoiceStageWeatherCard }) {
  return (
    <div className="px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CloudSun className="h-4 w-4 text-sky-500" />
            <span>{card.condition}</span>
          </div>
          {typeof card.temperature === 'number' && (
            <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
              {Math.round(card.temperature)}°
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
          {typeof card.feelsLike === 'number' && (
            <span className="tabular-nums">Feels like {Math.round(card.feelsLike)}°</span>
          )}
          <div className="flex items-center gap-3">
            {typeof card.humidity === 'number' && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Droplets className="h-3.5 w-3.5 text-sky-500" />
                {card.humidity}%
              </span>
            )}
            {typeof card.windKmh === 'number' && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Wind className="h-3.5 w-3.5 text-muted-foreground" />
                {card.windKmh} km/h
              </span>
            )}
          </div>
        </div>
      </div>

      {card.forecast.length > 0 && (
        <div className="mt-4 divide-y divide-border/60 border-t border-border/60 pt-2">
          {card.forecast.map((day, idx) => (
            <div
              key={`${card.id}-fc-${idx}`}
              className="flex items-center justify-between gap-3 py-2 text-xs"
            >
              <span className="font-medium text-foreground">{day.date}</span>
              <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                {day.condition}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-foreground">
                {Math.round(day.min)}° / {Math.round(day.max)}°
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RichCardBody({
  card,
  onDismiss,
}: {
  card: VoiceStageRichCard
  onDismiss: () => void
}) {
  const openSplit = useEvaControl((s) => s.openSplit)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const browserAction = useEvaControl((s) => s.browserAction)
  const setTab = useApp((s) => s.setTab)

  return (
    <div className="px-5 py-4 sm:px-6 sm:py-5">
      {card.headline && (
        <div className="text-2xl font-semibold tracking-tight tabular-nums text-foreground sm:text-3xl">
          {card.headline}
        </div>
      )}

      {card.body && (
        <p className={cn('whitespace-pre-wrap text-sm leading-relaxed text-foreground/90', card.headline && 'mt-2')}>
          {card.body}
        </p>
      )}

      {card.highlights && card.highlights.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-3.5">
          {card.highlights.map((h, idx) => (
            <div key={`${card.id}-hl-${idx}`} className="min-w-0">
              <dt className="truncate text-[11px] text-muted-foreground">{h.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">
                {h.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {card.actions && card.actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3.5">
          {card.actions.map((act, idx) => (
            <button
              key={`${card.id}-act-${idx}`}
              type="button"
              onClick={() => {
                triggerHaptic('light')
                if (act.tab && VALID_TABS.has(act.tab as Tab)) {
                  setLayoutMode('standard')
                  setTab(act.tab as Tab)
                }
                if (act.splitMode && VALID_SPLITS.has(act.splitMode as SplitMode)) {
                  openSplit(act.splitMode as SplitMode)
                }
                if (act.url) {
                  openSplit('browser', 'Live Browser')
                  void browserAction({ action: 'navigate', url: act.url })
                }
                onDismiss()
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-border bg-secondary px-3.5 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
            >
              <span>{act.label}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ListBody({ card }: { card: VoiceStageListCard }) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <ul className="divide-y divide-border/50">
        {card.items.map((item, idx) => (
          <li key={`${card.id}-li-${idx}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="mt-0.5 shrink-0 text-sky-500">
              {item.checked ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Circle className="h-3.5 w-3.5 opacity-60" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium text-foreground', item.checked && 'line-through opacity-60')}>
                {item.text}
              </p>
              {item.subtext && (
                <p className="mt-0.5 text-xs text-muted-foreground">{item.subtext}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {card.note && (
        <p className="mt-3 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          {card.note}
        </p>
      )}
    </div>
  )
}

function CodeBody({ card }: { card: VoiceStageCodeCard }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(card.code || card.output || '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore clipboard error */
    }
  }

  return (
    <div className="p-3.5 sm:p-4">
      <div className="relative overflow-hidden rounded-xl border border-border/70 bg-muted/40">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[11px] font-mono text-muted-foreground">
          <span>{card.language || 'code'}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        {card.code && (
          <pre className="max-h-44 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground">
            <code>{card.code}</code>
          </pre>
        )}
        {card.output && (
          <div className="border-t border-border/60 bg-background/60 px-3 py-2.5">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Output
            </div>
            <pre className="max-h-32 overflow-auto font-mono text-xs leading-relaxed text-foreground/90">
              <code>{card.output}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function KindIcon({ kind }: { kind: VoiceStageCard['kind'] }) {
  switch (kind) {
    case 'date_time':
      return <Calendar className="h-3.5 w-3.5 text-sky-500" />
    case 'image':
    case 'gallery':
      return <Images className="h-3.5 w-3.5 text-sky-500" />
    case 'weather':
      return <CloudSun className="h-3.5 w-3.5 text-sky-500" />
    case 'list':
      return <ListChecks className="h-3.5 w-3.5 text-sky-500" />
    case 'code':
      return <Code2 className="h-3.5 w-3.5 text-sky-500" />
    default:
      return <Sparkles className="h-3.5 w-3.5 text-sky-500" />
  }
}

export function VoiceStagePresenter({
  card,
  onDismiss,
  onTogglePin,
}: {
  card: VoiceStageCard
  onDismiss: () => void
  onTogglePin: () => void
}) {
  const reducedMotion = Boolean(useReducedMotion())
  const [lightbox, setLightbox] = useState<{ url: string; caption?: string } | null>(null)

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setLightbox(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  return (
    <>
      <motion.article
        key={card.id}
        data-voice-stage-card="1"
        data-voice-stage-kind={card.kind}
        aria-label={card.title}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border/80 bg-card/90 text-card-foreground shadow-xl backdrop-blur-md"
      >
        {/* Crisp single-row header — zero noisy pill clutter, >=44px touch targets */}
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <KindIcon kind={card.kind} />
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {card.title}
            </h2>
            {card.subtitle && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {card.subtitle}
                </span>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection')
                onTogglePin()
              }}
              aria-pressed={Boolean(card.pinned)}
              aria-label={card.pinned ? 'Unpin card' : 'Pin card on screen'}
              title={card.pinned ? 'Pinned — tap to allow auto-dismiss' : 'Pin card so it stays when topic changes'}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors sm:h-9 sm:w-9',
                card.pinned
                  ? 'bg-sky-500/12 text-sky-600 dark:text-sky-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {card.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
            <button
              type="button"
              data-voice-stage-close="1"
              onClick={() => {
                triggerHaptic('light')
                onDismiss()
              }}
              aria-label={`Close ${card.title}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Scrollable body capped so Coucou top-corner dock & subtitles below stay unobstructed */}
        <div className="max-h-[46dvh] overflow-y-auto sm:max-h-[54dvh]">
          {card.kind === 'date_time' && <DateTimeBody card={card} />}
          {card.kind === 'image' && (
            <ImageBody card={card} onInspect={(url, caption) => setLightbox({ url, caption })} />
          )}
          {card.kind === 'gallery' && (
            <GalleryBody card={card} onInspect={(url, caption) => setLightbox({ url, caption })} />
          )}
          {card.kind === 'weather' && <WeatherBody card={card} />}
          {card.kind === 'card' && <RichCardBody card={card} onDismiss={onDismiss} />}
          {card.kind === 'list' && <ListBody card={card} />}
          {card.kind === 'code' && <CodeBody card={card} />}
        </div>
      </motion.article>

      {/* Fullscreen Lightbox for inspecting generated / searched images */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded visual preview"
          >
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <a
                href={lightbox.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Download image"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
              >
                <Download className="h-5 w-5" />
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close expanded preview"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={lightbox.url}
              alt={lightbox.caption || 'Expanded visual'}
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[82dvh] max-w-[94vw] rounded-2xl object-contain shadow-2xl"
            />
            {lightbox.caption && (
              <p className="mt-3 max-w-xl text-center text-xs text-white/80">
                {lightbox.caption}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
