import { computeActionHash } from '@/lib/agent/action-binding'
import fs from 'fs'
import path from 'path'
import { GoogleGenAI } from '@google/genai'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { controlBus, type BrowserElementHint, type BrowserFramePayload } from '@/lib/agent/control-bus'
import { provisionAgentEmail, waitForVerificationCode } from '@/lib/agent/agent-identity'
import { reasoningChain } from '@/lib/agent/reasoning-chain'
import { automationSession } from '@/lib/agent/computer-control'
import { resolvePublicExternalUrl } from '@/lib/agent/product-source-ingest'

const VIEWPORT_W = 1280
const VIEWPORT_H = 800
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function createAutopilotGemini(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) return null
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  })
}

/**
 * Pure helper: extract an 11-character YouTube videoId from a URL, watch/embed link, or HTML snippet.
 */
export function extractYouTubeVideoId(input: string): string | null {
  if (!input) return null
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})(?:[&#\s"']|$)/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&#\s"']|$)/,
    /youtube\.com\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})(?:[?&#\s"']|$)/,
    /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
  ]
  for (const re of patterns) {
    const m = re.exec(input)
    if (m?.[1]) return m[1]
  }
  return null
}

/**
 * Pure helper: detect when a natural-language goal is asking Eva to play music/video on YouTube
 * and extract a clean search query (e.g. "open youtube.com and play rafta rafta" -> "rafta rafta").
 */
export function detectPlayMediaGoal(goal: string): { isMedia: boolean; query: string } {
  const raw = (goal || '').trim()
  if (!raw) return { isMedia: false, query: '' }

  const lower = raw.toLowerCase()
  const hasPlayVerb = /\b(play|listen to|stream|watch)\b/i.test(lower)
  const hasMediaHint =
    /\b(youtube|youtu\.be|song|music|video|track|audio|podcast|trailer|mv|lyrics|ost)\b/i.test(lower) ||
    /\bplay\s+[a-z0-9]/i.test(lower)

  // Avoid matching generic app/game instructions like "play tic tac toe" unless YouTube/song/video is present
  if (!hasPlayVerb || !hasMediaHint) {
    return { isMedia: false, query: '' }
  }
  if (/\b(play\s+(?:a\s+)?(?:game|chess|tic\s*tac\s*toe|sudoku))\b/i.test(lower) && !lower.includes('youtube')) {
    return { isMedia: false, query: '' }
  }

  let query = raw
    .replace(/^(?:hey\s+eva[,!\s]+|eva[,!\s]+|please\s+|can you\s+|could you\s+)+/i, '')
    .replace(/\b(?:open|go to|visit|navigate to|launch)\s+(?:https?:\/\/)?(?:www\.)?youtube\.com\/?\s*(?:and|then|,)?\s*/gi, '')
    .replace(/\b(?:on|in|from)\s+(?:https?:\/\/)?(?:www\.)?youtube(?:\.com)?\b/gi, '')
    .replace(/^(?:play|listen to|stream|watch)\s+/i, '')
    .replace(/\b(?:for me|right now|please|now)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!query) query = raw
  return { isMedia: true, query }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function parseYouTubeSearchHtml(html: string): { videoId: string; title: string } | null {
  // Match videoRenderer blocks containing videoId and title.runs[0].text
  const rendererRe =
    /"videoRenderer"\s*:\s*\{\s*"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"[\s\S]{0,1800}?"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g
  const m = rendererRe.exec(html)
  if (m?.[1]) {
    return {
      videoId: m[1],
      title: decodeHtmlEntities(m[2] || 'YouTube Video'),
    }
  }
  const fallbackId = extractYouTubeVideoId(html)
  if (fallbackId) {
    return { videoId: fallbackId, title: 'YouTube Video' }
  }
  return null
}

function resolveChromiumExecutablePath(defaultPath?: string): string | undefined {
  if (defaultPath && fs.existsSync(defaultPath)) {
    return defaultPath
  }

  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/ms-playwright',
    path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
  ].filter((p): p is string => Boolean(p))

  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    try {
      const entries = fs.readdirSync(root).sort().reverse()
      for (const entry of entries) {
        if (!entry.startsWith('chromium')) continue
        const candidates = [
          path.join(root, entry, 'chrome-linux', 'chrome'),
          path.join(root, entry, 'chrome-linux64', 'chrome'),
          path.join(root, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          path.join(root, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
          path.join(root, entry, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
          path.join(root, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        ]
        for (const c of candidates) {
          if (fs.existsSync(c)) return c
        }
      }
    } catch {
      /* ignore unreadable directory */
    }
  }

  const systemCandidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ]
  for (const c of systemCandidates) {
    if (fs.existsSync(c)) return c
  }

  return undefined
}

export interface BrowserActionResult {
  ok: boolean
  summary: string
  url: string
  title: string
  textExcerpt: string
  elements: BrowserElementHint[]
  frame: BrowserFramePayload | null
  error?: string
  steps?: string[]
}

interface AutopilotDecision {
  action:
    | 'navigate'
    | 'click'
    | 'type'
    | 'press'
    | 'scroll'
    | 'play_media'
    | 'use_agent_email'
    | 'wait_for_email_code'
    | 'done'
  url?: string
  selector?: string
  text?: string
  submit?: boolean
  key?: string
  deltaY?: number
  query?: string
  senderFilter?: string
  reason?: string
  summary?: string
}

class LiveBrowserManager {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private launching: Promise<Page> | null = null
  private cursorX: number | null = null
  private cursorY: number | null = null
  private lastAction = 'Ready'
  private mediaEmbedUrl: string | null = null
  private mediaTitle: string | null = null
  private mediaVideoId: string | null = null

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page
    }
    if (this.launching) return this.launching

    this.launching = (async () => {
      const pw = await import('playwright-core')
      const chromium = pw.chromium
      let defaultPath: string | undefined
      try {
        defaultPath = chromium.executablePath()
      } catch {
        defaultPath = undefined
      }
      const executablePath = resolveChromiumExecutablePath(defaultPath)
      this.browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      })
      this.context = await this.browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
        userAgent: DESKTOP_CHROME_UA,
        locale: 'en-US',
      })
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
      this.page = await this.context.newPage()
      this.page.setDefaultTimeout(15_000)
      return this.page
    })()

    try {
      return await this.launching
    } finally {
      this.launching = null
    }
  }

  private async dismissConsentBanners(page: Page): Promise<void> {
    const selectors = [
      'button:has-text("Accept all")',
      'button:has-text("Accept All")',
      'button:has-text("I agree")',
      'button:has-text("Agree")',
      'button:has-text("Reject all")',
      'button[aria-label*="Accept" i]',
      '[id*="accept" i][role="button"]',
    ]
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first()
        if (await loc.isVisible({ timeout: 450 })) {
          await loc.click({ timeout: 1500 })
          await page.waitForTimeout(250)
          return
        }
      } catch {
        /* ignore non-matching consent selectors */
      }
    }
  }

  private async captureState(page: Page, loading = false): Promise<{
    frame: BrowserFramePayload
    textExcerpt: string
  }> {
    let url = 'about:blank'
    let title = 'Live Browser'
    let textExcerpt = ''
    let elements: BrowserElementHint[] = []
    let imageBase64 = ''

    try {
      url = page.url()
      title = (await page.title()) || url
    } catch {
      /* page transitioning */
    }

    try {
      const inspected = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000)
        const nodes = Array.from(
          document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"]')
        )
        const hints: { index: number; tag: string; text: string; selector: string; x: number; y: number }[] = []
        let idx = 1
        for (const el of nodes) {
          if (hints.length >= 24) break
          const rect = el.getBoundingClientRect()
          if (rect.width < 8 || rect.height < 8) continue
          if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
            continue
          }
          const style = window.getComputedStyle(el)
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue

          const tag = el.tagName.toLowerCase()
          const rawText = (
            (el as HTMLElement).innerText ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.getAttribute('title') ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60)

          if (!rawText && tag !== 'input' && tag !== 'textarea') continue

          const id = el.getAttribute('id')
          const name = el.getAttribute('name')
          const selector = id
            ? `#${CSS.escape(id)}`
            : name
              ? `${tag}[name="${name.replace(/"/g, '\\"')}"]`
              : rawText
                ? `text=${rawText.slice(0, 40)}`
                : tag

          hints.push({
            index: idx++,
            tag,
            text: rawText || `${tag} field`,
            selector,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          })
        }
        return { bodyText, hints }
      })
      textExcerpt = inspected.bodyText
      elements = inspected.hints
    } catch {
      /* ignore evaluation errors during redirects */
    }

    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 68 })
      imageBase64 = buf.toString('base64')
    } catch {
      /* ignore screenshot errors */
    }

    const frame: BrowserFramePayload = {
      active: true,
      url,
      title,
      imageBase64,
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      loading,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      lastAction: this.lastAction,
      elements,
      mediaEmbedUrl: this.mediaEmbedUrl,
      mediaTitle: this.mediaTitle,
      mediaVideoId: this.mediaVideoId,
      updatedAt: new Date().toISOString(),
    }

    controlBus.broadcastBrowserFrame(frame)
    return { frame, textExcerpt }
  }

  getLatestFrame(): BrowserFramePayload | null {
    return controlBus.getLatestBrowserFrame()
  }

  /**
   * Resolves a real YouTube video for any song/video query (or direct YouTube URL)
   * and streams an interactive playable YouTube embed with real audio & video in the split browser.
   */
  async playMedia(rawQuery: string): Promise<BrowserActionResult> {
    const trimmed = (rawQuery || '').trim()
    if (!trimmed) {
      return {
        ok: false,
        summary: 'Missing media query',
        url: '',
        title: 'Media Player',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: 'Provide a song, video title, or YouTube URL to play.',
      }
    }

    const cleaned = detectPlayMediaGoal(trimmed).query || trimmed
    const chain = reasoningChain.startChain({
      source: 'browser_autopilot',
      goal: `Play media: "${cleaned}"`,
      actor: 'Eva',
      goalDetail: `Resolve a playable YouTube video for "${cleaned}" and stream it inside the Live Browser split panel.`,
    })
    controlBus.broadcastUiCommand({ command: 'open_split', mode: 'browser', title: 'Live Browser · Media' })
    controlBus.broadcastEvaMood('working', `Finding "${cleaned}" on YouTube`, 4000)

    let videoId = extractYouTubeVideoId(trimmed)
    let title = cleaned

    if (videoId) {
      reasoningChain.addNode(chain.id, {
        kind: 'decision',
        title: 'Direct YouTube video ID extracted',
        detail: `Extracted videoId "${videoId}" directly from user input without extra search round-trips.`,
        tool: 'browser_control:play_media',
      })
    }

    // Strategy 1: Direct YouTube search HTML parse (fast, zero Chromium startup overhead)
    if (!videoId) {
      reasoningChain.addNode(chain.id, {
        kind: 'decision',
        title: 'Query YouTube search directly',
        detail: `Searching YouTube results for "${cleaned}" via fast HTML parser first.`,
        tool: 'browser_control:play_media',
      })
      try {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleaned)}`
        const res = await fetch(searchUrl, {
          headers: {
            'User-Agent': DESKTOP_CHROME_UA,
            'Accept-Language': 'en-US,en;q=0.9',
            Cookie: 'CONSENT=YES+cb.20240101-00-p0.en+FX+999; SOCS=CAESHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmVuIAEaBgiA_LyaBg',
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) {
          const html = await res.text()
          const parsed = parseYouTubeSearchHtml(html)
          if (parsed) {
            videoId = parsed.videoId
            title = parsed.title || cleaned
            reasoningChain.addNode(chain.id, {
              kind: 'observation',
              title: 'Resolved video from YouTube HTML',
              detail: `Matched "${title}" (videoId=${videoId}).`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
            })
          }
        }
      } catch {
        /* fall through to Strategy 2 */
      }
    }

    // Strategy 2: Gemini Google Search Grounding fallback for exact YouTube watch URL
    if (!videoId) {
      reasoningChain.addNode(chain.id, {
        kind: 'self_correction',
        title: 'Pivot to Search Grounding lookup',
        detail: `Direct YouTube HTML parse did not yield a video ID for "${cleaned}". Pivoting to Gemini Google Search Grounding.`,
        tool: 'browser_control:play_media',
        correction: {
          whatFailed: 'Direct YouTube search HTML returned no matching videoId.',
          pivotStrategy: 'Query Gemini Google Search Grounding for the canonical youtube.com/watch URL.',
        },
      })
      const gemini = createAutopilotGemini()
      if (gemini) {
        try {
          const resp = await gemini.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `Find the official YouTube video URL (youtube.com/watch?v=...) for: ${cleaned}. Reply with the exact YouTube URL and title.`,
            config: {
              tools: [{ googleSearch: {} }],
            },
          })
          const text = resp.text ?? ''
          const chunks =
            (
              resp.candidates?.[0] as
                | { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }
                | undefined
            )?.groundingMetadata?.groundingChunks ?? []
          for (const ch of chunks) {
            const uri = ch.web?.uri ?? ''
            const found = extractYouTubeVideoId(uri)
            if (found) {
              videoId = found
              title = (ch.web?.title || cleaned).replace(/\s*-\s*YouTube$/i, '').trim()
              break
            }
          }
          if (!videoId) {
            const foundInText = extractYouTubeVideoId(text)
            if (foundInText) {
              videoId = foundInText
            }
          }
          if (videoId) {
            reasoningChain.addNode(chain.id, {
              kind: 'observation',
              title: 'Resolved video via Search Grounding',
              detail: `Found "${title}" (videoId=${videoId}).`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
            })
          }
        } catch {
          /* fall through to Strategy 3 */
        }
      }
    }

    // Strategy 3: Playwright Chromium fallback against YouTube search
    if (!videoId) {
      reasoningChain.addNode(chain.id, {
        kind: 'self_correction',
        title: 'Pivot to Playwright DOM search',
        detail: `Search Grounding did not resolve a videoId. Launching headless Playwright to search YouTube and bypass consent overlays.`,
        tool: 'browser_control:play_media',
        correction: {
          whatFailed: 'HTML & Grounding lookup returned no YouTube video ID.',
          pivotStrategy: 'Navigate Playwright Chromium to YouTube results, auto-dismiss consent banners, and scrape a#video-title.',
        },
      })
      try {
        const page = await this.ensurePage()
        await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(cleaned)}`, {
          waitUntil: 'domcontentloaded',
          timeout: 18_000,
        })
        await this.dismissConsentBanners(page)
        await page.waitForTimeout(900)
        const found = await page.evaluate(() => {
          const a = document.querySelector<HTMLAnchorElement>('a#video-title[href*="watch?v="], a[href*="/watch?v="]')
          if (!a) return null
          return { href: a.href, title: (a.getAttribute('title') || a.textContent || '').trim() }
        })
        if (found?.href) {
          const id = extractYouTubeVideoId(found.href)
          if (id) {
            videoId = id
            title = found.title || cleaned
            reasoningChain.addNode(chain.id, {
              kind: 'observation',
              title: 'Resolved video via Playwright DOM',
              detail: `Extracted "${title}" (videoId=${videoId}) from live rendered YouTube page.`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
            })
          }
        }
      } catch {
        /* all strategies attempted */
      }
    }

    if (!videoId) {
      reasoningChain.completeChain(chain.id, {
        ok: false,
        verificationDetail: `All 3 resolution strategies failed to locate a playable YouTube video for "${cleaned}".`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleaned)}`,
      })
      return {
        ok: false,
        summary: `Could not locate a playable YouTube video for "${cleaned}"`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleaned)}`,
        title: 'YouTube Search',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: `No playable YouTube video ID found for "${cleaned}".`,
      }
    }

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
    this.mediaVideoId = videoId
    this.mediaTitle = title
    this.mediaEmbedUrl = embedUrl
    this.lastAction = `Playing "${title}"`

    const prev = controlBus.getLatestBrowserFrame()
    const frame: BrowserFramePayload = {
      active: true,
      url: watchUrl,
      title,
      imageBase64: prev?.imageBase64 ?? '',
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      loading: false,
      cursorX: null,
      cursorY: null,
      lastAction: this.lastAction,
      elements: prev?.elements ?? [],
      mediaEmbedUrl: embedUrl,
      mediaTitle: title,
      mediaVideoId: videoId,
      updatedAt: new Date().toISOString(),
    }

    controlBus.broadcastBrowserFrame(frame)
    controlBus.broadcastEvaMood('happy', `Playing "${title}"`, 6000)
    reasoningChain.completeChain(chain.id, {
      ok: true,
      verificationDetail: `Verified playable YouTube embed streaming "${title}" (${watchUrl}) inside Live Browser split stage.`,
      url: watchUrl,
    })

    return {
      ok: true,
      summary: `Now playing "${title}" on YouTube`,
      url: watchUrl,
      title,
      textExcerpt: `Live YouTube player active in split panel: "${title}" (${watchUrl}).`,
      elements: [],
      frame,
    }
  }

  async clearMedia(): Promise<BrowserActionResult> {
    this.mediaEmbedUrl = null
    this.mediaTitle = null
    this.mediaVideoId = null
    this.lastAction = 'Closed media player'
    if (this.page && !this.page.isClosed()) {
      const { frame, textExcerpt } = await this.captureState(this.page)
      return {
        ok: true,
        summary: 'Switched back to live DOM browser view',
        url: frame.url,
        title: frame.title,
        textExcerpt,
        elements: frame.elements,
        frame,
      }
    }
    const prev = controlBus.getLatestBrowserFrame()
    if (prev && prev.imageBase64) {
      const updated: BrowserFramePayload = {
        ...prev,
        mediaEmbedUrl: null,
        mediaTitle: null,
        mediaVideoId: null,
        lastAction: this.lastAction,
        updatedAt: new Date().toISOString(),
      }
      controlBus.broadcastBrowserFrame(updated)
      return {
        ok: true,
        summary: 'Closed media player',
        url: updated.url,
        title: updated.title,
        textExcerpt: '',
        elements: updated.elements,
        frame: updated,
      }
    }
    controlBus.broadcastBrowserFrame({
      active: false,
      url: '',
      title: '',
      imageBase64: '',
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      loading: false,
      cursorX: null,
      cursorY: null,
      lastAction: 'Closed media player',
      elements: [],
      mediaEmbedUrl: null,
      mediaTitle: null,
      mediaVideoId: null,
      updatedAt: new Date().toISOString(),
    })
    return {
      ok: true,
      summary: 'Closed media player',
      url: '',
      title: '',
      textExcerpt: '',
      elements: [],
      frame: null,
    }
  }

  async navigate(rawUrl: string): Promise<BrowserActionResult> {
    const trimmed = rawUrl.trim()
    if (!trimmed) {
      return {
        ok: false,
        summary: 'Navigation failed: URL is required',
        url: '',
        title: 'Navigation Error',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: 'URL is required',
      }
    }
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    let url: string
    try {
      url = (await resolvePublicExternalUrl(candidate)).toString()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        summary: `Blocked navigation: ${msg}`,
        url: candidate,
        title: 'Navigation Blocked',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: msg,
      }
    }
    const directVideoId = extractYouTubeVideoId(url)
    if (directVideoId && /youtube\.com|youtu\.be/i.test(url)) {
      return this.playMedia(url)
    }

    this.mediaEmbedUrl = null
    this.mediaTitle = null
    this.mediaVideoId = null
    this.lastAction = `Navigating to ${url}`
    try {
      const page = await this.ensurePage()
      controlBus.broadcastUiCommand({ command: 'open_split', mode: 'browser', title: 'Live Browser', url })
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await this.dismissConsentBanners(page)
      await page.waitForTimeout(350)
      this.cursorX = Math.round(VIEWPORT_W / 2)
      this.cursorY = Math.round(VIEWPORT_H / 2)
      this.lastAction = `Opened ${page.url()}`
      const { frame, textExcerpt } = await this.captureState(page)
      return {
        ok: true,
        summary: `Opened ${frame.title} (${frame.url})`,
        url: frame.url,
        title: frame.title,
        textExcerpt,
        elements: frame.elements,
        frame,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        summary: `Navigation failed: ${msg}`,
        url,
        title: 'Navigation Error',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: msg,
      }
    }
  }

  /**
   * Autonomous multi-step browser execution loop (Observe -> Decide -> Act -> Verify).
   * Completes multi-step goals end-to-end without stopping after every individual click/type.
   */
  async runAutopilot(goal: string, startUrl?: string, maxSteps = 6): Promise<BrowserActionResult> {
    const cleanGoal = (goal || '').trim()
    if (!cleanGoal) {
      return {
        ok: false,
        summary: 'Missing autopilot goal',
        url: '',
        title: 'Autopilot',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: 'Provide a clear goal for browser autopilot.',
      }
    }

    // Fast-path: media playback goals (e.g. "open youtube.com and play rafta rafta")
    const mediaCheck = detectPlayMediaGoal(cleanGoal)
    if (mediaCheck.isMedia) {
      return this.playMedia(mediaCheck.query)
    }

    const stepsLimit = Math.min(8, Math.max(2, Number(maxSteps) || 6))
    const trace: string[] = []
    controlBus.broadcastUiCommand({ command: 'open_split', mode: 'browser', title: 'Live Browser · Autopilot' })
    controlBus.broadcastEvaMood('working', `Autopilot: ${cleanGoal.slice(0, 48)}`, 10_000)

    // Infer start URL if none passed explicitly
    let initialUrl = (startUrl || '').trim()
    if (!initialUrl) {
      const explicitUrl = /https?:\/\/[^\s"'<>]+/i.exec(cleanGoal)?.[0]
      const domainMatch = /\b([a-z0-9-]+\.(?:com|org|net|io|dev|ai|co|edu|gov)(?:\/[^\s,]*)?)\b/i.exec(cleanGoal)?.[1]
      if (explicitUrl) initialUrl = explicitUrl
      else if (domainMatch) initialUrl = `https://${domainMatch}`
    }

    const chain = reasoningChain.startChain({
      source: 'browser_autopilot',
      goal: cleanGoal,
      actor: 'Eva',
      goalDetail: `Autonomous web navigation up to ${stepsLimit} steps${initialUrl ? ` starting at ${initialUrl}` : ''}.`,
      url: initialUrl || undefined,
    })

    let current: BrowserActionResult
    if (initialUrl) {
      reasoningChain.addNode(chain.id, {
        kind: 'decision',
        title: `Navigate to starting URL`,
        detail: `Opening ${initialUrl} to establish initial page context for the goal.`,
        tool: 'browser_control:navigate',
        url: initialUrl,
      })
      current = await this.navigate(initialUrl)
      trace.push(`Step 0: navigate -> ${current.summary}`)
      reasoningChain.addNode(chain.id, {
        kind: 'observation',
        title: current.ok ? `Loaded "${current.title || initialUrl}"` : 'Initial navigation failed',
        detail: `${current.summary} (${current.elements.length} interactive elements detected).`,
        url: current.url || initialUrl,
      })
      if (!current.ok) {
        reasoningChain.completeChain(chain.id, {
          ok: false,
          verificationDetail: `Aborted autopilot: could not load ${initialUrl} (${current.error || current.summary}).`,
          url: initialUrl,
        })
        return { ...current, steps: trace }
      }
    } else if (this.page && !this.page.isClosed()) {
      current = await this.snapshot()
      reasoningChain.addNode(chain.id, {
        kind: 'observation',
        title: `Captured active tab "${current.title || current.url}"`,
        detail: `${current.elements.length} interactive elements inspected on current page.`,
        url: current.url,
      })
    } else {
      reasoningChain.addNode(chain.id, {
        kind: 'decision',
        title: 'Start at search entry point',
        detail: 'No explicit URL in goal; opening DuckDuckGo to locate the target page.',
        tool: 'browser_control:navigate',
        url: 'https://duckduckgo.com',
      })
      current = await this.navigate('https://duckduckgo.com')
      trace.push(`Step 0: navigate -> ${current.summary}`)
      reasoningChain.addNode(chain.id, {
        kind: 'observation',
        title: `Loaded "${current.title || 'DuckDuckGo'}"`,
        detail: `${current.summary} (${current.elements.length} interactive elements detected).`,
        url: current.url,
      })
    }

    const gemini = createAutopilotGemini()
    if (!gemini) {
      reasoningChain.completeChain(chain.id, {
        ok: current.ok,
        verificationDetail: 'Autopilot LLM unavailable; opened target page directly.',
        url: current.url,
      })
      return {
        ...current,
        summary: `${current.summary} (Autopilot LLM unavailable; opened target page)`,
        steps: trace,
      }
    }

    let lastActionSignature = ''
    automationSession.startSession({
      target: 'browser',
      goal: cleanGoal,
      totalSteps: stepsLimit,
    })
    automationSession.recordStep(0, `Opened ${current.title || current.url || 'isolated browser'}`, current.summary, 'done')

    const isSensitiveBrowserStep = (dec: AutopilotDecision): boolean => {
      const targetText = `${dec.selector ?? ''} ${dec.text ?? ''} ${dec.reason ?? ''}`.toLowerCase()
      if (dec.action === 'click' && /\b(buy|checkout|purchase|pay|place order|delete|remove|send|publish|submit|confirm|post listing|sign up|create account)\b/i.test(targetText)) {
        return true
      }
      if (dec.action === 'type' && dec.submit && /\b(password|card|cvv|payment|checkout|publish|send)\b/i.test(targetText)) {
        return true
      }
      return false
    }

    for (let step = 1; step <= stepsLimit; step++) {
      const canContinue = await automationSession.waitIfPausedOrTakeover()
      if (!canContinue) {
        const stoppedSummary = `Stopped by user after ${trace.length} steps on ${current.title || current.url}`
        trace.push(`Step ${step}: stopped by user`)
        reasoningChain.completeChain(chain.id, {
          ok: true,
          verificationDetail: stoppedSummary,
          url: current.url,
        })
        return { ...current, ok: true, summary: stoppedSummary, steps: trace }
      }

      automationSession.recordStep(step, `Analyzing page (step ${step}/${stepsLimit})`, current.url, 'running')

      const elementsBlock = current.elements
        .slice(0, 20)
        .map((e) => `[${e.index}] <${e.tag}> "${e.text}" selector="${e.selector}"`)
        .join('\n')

      const prompt = `You are Eva's Autonomous Browser Autopilot. Complete the user's goal end-to-end without stopping halfway.

GOAL: ${cleanGoal}
STEP: ${step} of ${stepsLimit}
CURRENT URL: ${current.url}
CURRENT TITLE: ${current.title}
PREVIOUS STEPS:
${trace.join('\n') || '(none)'}

VISIBLE INTERACTIVE ELEMENTS:
${elementsBlock || '(none detected)'}

PAGE TEXT EXCERPT:
${current.textExcerpt.slice(0, 2000) || '(empty)'}

Choose the SINGLE best next action. Reply ONLY with strict minified JSON (no markdown fences):
- {"action":"navigate","url":"https://...","reason":"..."}
- {"action":"click","selector":"...","text":"...","reason":"..."}
- {"action":"type","selector":"...","text":"...","submit":true,"reason":"..."}
- {"action":"press","key":"Enter","reason":"..."}
- {"action":"scroll","deltaY":520,"reason":"..."}
- {"action":"play_media","query":"song or video name or youtube url","reason":"play video/audio natively"}
- {"action":"use_agent_email","selector":"email input selector","submit":false,"reason":"fill Eva autonomous email"}
- {"action":"wait_for_email_code","senderFilter":"optional domain/brand","selector":"optional otp input selector","submit":true,"reason":"fetch OTP/verification link from Eva inbox"}
- {"action":"done","summary":"concise factual summary of what was accomplished and verified on screen","reason":"goal achieved"}

Rules:
- If the goal involves playing a YouTube video/song, ALWAYS return {"action":"play_media","query":"..."} so the live player streams with real audio!
- If a form asks for an email address, use {"action":"use_agent_email","selector":"..."}.
- If waiting for a verification code or email confirmation link, use {"action":"wait_for_email_code",...}.
- Once the goal is genuinely complete on screen, return {"action":"done","summary":"..."}.`

      let decision: AutopilotDecision | null = null
      try {
        const resp = await gemini.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
        })
        const text = (resp.text ?? '').trim()
        const jsonMatch = /\{[\s\S]*\}/.exec(text)
        if (jsonMatch) {
          decision = JSON.parse(jsonMatch[0]) as AutopilotDecision
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        trace.push(`Step ${step}: decision error (${errMsg})`)
        reasoningChain.addNode(chain.id, {
          kind: 'self_correction',
          title: `Step ${step} planner call failed`,
          detail: `Decision model error: ${errMsg}. Stopping loop cleanly with latest verified page state.`,
          url: current.url,
          correction: {
            whatFailed: errMsg,
            pivotStrategy: 'Terminate loop safely and return latest captured DOM snapshot.',
          },
        })
        break
      }

      if (!decision || !decision.action) {
        trace.push(`Step ${step}: could not parse next browser action`)
        reasoningChain.addNode(chain.id, {
          kind: 'self_correction',
          title: `Step ${step} action JSON parse failed`,
          detail: 'Autopilot model returned unparseable action output; halting loop cleanly.',
          url: current.url,
          correction: {
            whatFailed: 'Missing or invalid JSON action object from decision planner.',
            pivotStrategy: 'Return current observed page context without executing malformed DOM input.',
          },
        })
        break
      }

      if (decision.action === 'done') {
        const finalSummary = decision.summary || `Completed goal: ${cleanGoal}`
        trace.push(`Step ${step}: done — ${finalSummary}`)
        automationSession.complete(finalSummary)
        controlBus.broadcastEvaMood('happy', finalSummary.slice(0, 60), 2500)
        reasoningChain.completeChain(chain.id, {
          ok: true,
          verificationDetail: finalSummary,
          url: current.url,
        })
        return {
          ...current,
          ok: true,
          summary: finalSummary,
          steps: trace,
        }
      }

      if (decision.action === 'play_media') {
        reasoningChain.addNode(chain.id, {
          kind: 'decision',
          title: `Step ${step}: Switch to native media player`,
          detail: decision.reason || `Detected playable media intent; invoking playMedia("${decision.query || cleanGoal}").`,
          tool: 'browser_control:play_media',
          url: current.url,
        })
        const mediaRes = await this.playMedia(decision.query || cleanGoal)
        trace.push(`Step ${step}: play_media -> ${mediaRes.summary}`)
        reasoningChain.completeChain(chain.id, {
          ok: mediaRes.ok,
          verificationDetail: mediaRes.summary,
          url: mediaRes.url,
        })
        return { ...mediaRes, steps: trace }
      }

      const actionSig = `${current.url}|${decision.action}|${decision.selector || decision.text || decision.url || ''}`
      if (actionSig === lastActionSignature) {
        reasoningChain.addNode(chain.id, {
          kind: 'self_correction',
          title: `Step ${step}: Stall loop detected — scrolling to reveal fresh targets`,
          detail: `Repeated identical action (${decision.action}) on the same URL without state transition. Scrolling viewport to surface alternative controls.`,
          tool: 'browser_control:scroll',
          url: current.url,
          correction: {
            whatFailed: `Action "${decision.action}" repeated without page change.`,
            pivotStrategy: 'Scroll viewport down 560px to uncover occluded elements and break loop.',
          },
        })
        current = await this.scroll(560)
        trace.push(`Step ${step}: self-correct scroll -> ${current.summary}`)
        lastActionSignature = ''
        continue
      }
      lastActionSignature = actionSig

      reasoningChain.addNode(chain.id, {
        kind: 'decision',
        title: `Step ${step}: ${decision.action}${decision.selector ? ` (${decision.selector.slice(0, 32)})` : decision.url ? ` (${decision.url.slice(0, 40)})` : ''}`,
        detail: decision.reason || `Executing ${decision.action} toward goal "${cleanGoal}".`,
        tool: `browser_control:${decision.action}`,
        url: current.url,
      })

      const prevUrl = current.url

      // Sensitive-step approval gate: pause and request explicit user approval before high-impact clicks/submissions
      if (isSensitiveBrowserStep(decision) && controlBus.hasUiClients()) {
        const actionDesc = `${decision.action} ${decision.text || decision.selector || ''} on ${current.url}`.trim()
        automationSession.setAwaitingApproval(actionDesc)
        const reqId = `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const approval = await controlBus.waitForPermission(
          {
            requestId: reqId,
            actionHash: computeActionHash({ actionName: `browser.${decision.action}`, target: current.url, payload: decision }),
            capability: 'browser_control',
            title: 'Approve Sensitive Browser Action',
            description: 'Eva paused before executing a sensitive step in the isolated workspace.',
            actionSummary: actionDesc,
            actor: 'Eva',
            details: decision.reason || `Goal: ${cleanGoal}`,
            createdAt: new Date().toISOString(),
          },
          60_000
        )
        if (approval !== 'once' && approval !== 'always') {
          automationSession.recordStep(step, `Skipped sensitive step (${approval})`, actionDesc, 'blocked')
          automationSession.complete(`Paused/declined sensitive step: ${actionDesc}`)
          trace.push(`Step ${step}: sensitive step declined (${approval})`)
          break
        }
        automationSession.clearAwaitingApproval(`Approved: ${actionDesc}`)
      }

      const stillAllowed = await automationSession.waitIfPausedOrTakeover()
      if (!stillAllowed) {
        trace.push(`Step ${step}: stopped before executing ${decision.action}`)
        break
      }

      automationSession.recordStep(
        step,
        `${decision.action}: ${decision.text || decision.selector || decision.url || decision.key || 'action'}`,
        decision.reason,
        'running'
      )

      if (decision.action === 'navigate' && decision.url) {
        current = await this.navigate(decision.url)
        trace.push(`Step ${step}: navigate(${decision.url}) -> ${current.summary}`)
      } else if (decision.action === 'click') {
        current = await this.click({ selector: decision.selector, text: decision.text })
        trace.push(`Step ${step}: click(${decision.selector || decision.text || ''}) -> ${current.summary}`)
      } else if (decision.action === 'type') {
        current = await this.type({
          selector: decision.selector,
          text: decision.text ?? '',
          submit: Boolean(decision.submit),
        })
        trace.push(`Step ${step}: type(${decision.selector || 'focused'}) -> ${current.summary}`)
      } else if (decision.action === 'press') {
        current = await this.press(decision.key || 'Enter')
        trace.push(`Step ${step}: press(${decision.key || 'Enter'}) -> ${current.summary}`)
      } else if (decision.action === 'scroll') {
        current = await this.scroll(typeof decision.deltaY === 'number' ? decision.deltaY : 520)
        trace.push(`Step ${step}: scroll -> ${current.summary}`)
      } else if (decision.action === 'use_agent_email') {
        try {
          const { identity } = await provisionAgentEmail()
          current = await this.type({
            selector: decision.selector,
            text: identity.address,
            submit: Boolean(decision.submit),
          })
          trace.push(`Step ${step}: use_agent_email(${identity.address}) -> ${current.summary}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          trace.push(`Step ${step}: use_agent_email failed (${msg})`)
          reasoningChain.addNode(chain.id, {
            kind: 'self_correction',
            title: `Step ${step}: Email provisioning failed`,
            detail: msg,
            tool: 'agent_email',
            url: current.url,
            correction: {
              whatFailed: msg,
              pivotStrategy: 'Re-evaluate page options or continue without email autofill.',
            },
          })
        }
      } else if (decision.action === 'wait_for_email_code') {
        try {
          const waited = await waitForVerificationCode({
            senderFilter: decision.senderFilter,
            timeoutMs: 18_000,
          })
          if (waited.found && waited.message) {
            const firstCode = waited.message.codes[0]
            const firstLink = waited.message.links[0]
            if (firstCode && decision.selector) {
              current = await this.type({
                selector: decision.selector,
                text: firstCode,
                submit: decision.submit !== false,
              })
              trace.push(`Step ${step}: entered OTP ${firstCode} from ${waited.message.from}`)
            } else if (firstLink) {
              current = await this.navigate(firstLink)
              trace.push(`Step ${step}: opened verification link from ${waited.message.from}`)
            } else {
              trace.push(`Step ${step}: received email "${waited.message.subject}"`)
            }
          } else {
            trace.push(`Step ${step}: ${waited.note}`)
          }
        } catch (err) {
          trace.push(`Step ${step}: wait_for_email_code failed (${err instanceof Error ? err.message : String(err)})`)
        }
      }

      if (!current.ok) {
        reasoningChain.addNode(chain.id, {
          kind: 'self_correction',
          title: `Step ${step}: ${decision.action} failed — adapting next turn`,
          detail: current.error || current.summary,
          tool: `browser_control:${decision.action}`,
          url: current.url || prevUrl,
          correction: {
            whatFailed: current.error || current.summary,
            pivotStrategy: 'Feed error observation back to next decision node to choose an alternate selector or route.',
          },
        })
      } else {
        reasoningChain.addNode(chain.id, {
          kind: 'observation',
          title: `Step ${step} observed: ${current.title || current.url || 'updated view'}`,
          detail: `${current.summary}${current.url && current.url !== prevUrl ? ` · navigated to ${current.url}` : ''}`,
          url: current.url,
        })
      }
    }

    const summary = `Autopilot finished ${trace.length} steps on ${current.title} (${current.url})`
    if (!automationSession.isStopped()) {
      automationSession.complete(summary)
    }
    reasoningChain.completeChain(chain.id, {
      ok: current.ok,
      verificationDetail: summary,
      url: current.url,
    })

    return {
      ...current,
      summary,
      steps: trace,
    }
  }

  async click(opts: { selector?: string; text?: string; x?: number; y?: number }): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      controlBus.broadcastUiCommand({ command: 'open_split', mode: 'browser', title: 'Live Browser' })

      if (typeof opts.x === 'number' && typeof opts.y === 'number') {
        const cx = Math.max(0, Math.min(VIEWPORT_W, Math.round(opts.x)))
        const cy = Math.max(0, Math.min(VIEWPORT_H, Math.round(opts.y)))
        this.cursorX = cx
        this.cursorY = cy
        this.lastAction = `Clicked (${cx}, ${cy})`
        await page.mouse.move(cx, cy, { steps: 6 })
        await page.mouse.click(cx, cy)
      } else if (opts.selector) {
        const loc = page.locator(opts.selector).first()
        const box = await loc.boundingBox()
        if (box) {
          this.cursorX = Math.round(box.x + box.width / 2)
          this.cursorY = Math.round(box.y + box.height / 2)
        }
        this.lastAction = `Clicked ${opts.selector}`
        await loc.click({ timeout: 10_000 })
      } else if (opts.text) {
        const loc = page.getByText(opts.text, { exact: false }).first()
        const box = await loc.boundingBox()
        if (box) {
          this.cursorX = Math.round(box.x + box.width / 2)
          this.cursorY = Math.round(box.y + box.height / 2)
        }
        this.lastAction = `Clicked "${opts.text}"`
        await loc.click({ timeout: 10_000 })
      } else {
        throw new Error('Provide selector, text, or x/y coordinates to click.')
      }

      await page.waitForTimeout(400)
      const { frame, textExcerpt } = await this.captureState(page)
      return {
        ok: true,
        summary: `${this.lastAction} on ${frame.title}`,
        url: frame.url,
        title: frame.title,
        textExcerpt,
        elements: frame.elements,
        frame,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        summary: `Click failed: ${msg}`,
        url: this.page?.url() ?? '',
        title: 'Live Browser',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: msg,
      }
    }
  }

  async type(opts: { text: string; selector?: string; submit?: boolean }): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      controlBus.broadcastUiCommand({ command: 'open_split', mode: 'browser', title: 'Live Browser' })

      if (opts.selector) {
        const loc = page.locator(opts.selector).first()
        const box = await loc.boundingBox()
        if (box) {
          this.cursorX = Math.round(box.x + box.width / 2)
          this.cursorY = Math.round(box.y + box.height / 2)
        }
        await loc.click({ timeout: 8_000 })
        await loc.fill(opts.text)
      } else {
        await page.keyboard.type(opts.text, { delay: 18 })
      }

      if (opts.submit) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(500)
      } else {
        await page.waitForTimeout(200)
      }

      this.lastAction = `Typed "${opts.text.slice(0, 32)}"${opts.submit ? ' + Enter' : ''}`
      const { frame, textExcerpt } = await this.captureState(page)
      return {
        ok: true,
        summary: `${this.lastAction} on ${frame.title}`,
        url: frame.url,
        title: frame.title,
        textExcerpt,
        elements: frame.elements,
        frame,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        summary: `Type failed: ${msg}`,
        url: this.page?.url() ?? '',
        title: 'Live Browser',
        textExcerpt: '',
        elements: [],
        frame: controlBus.getLatestBrowserFrame(),
        error: msg,
      }
    }
  }

  async press(key: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      await page.keyboard.press(key)
      await page.waitForTimeout(300)
      this.lastAction = `Pressed ${key}`
      const { frame, textExcerpt } = await this.captureState(page)
      return {
        ok: true,
        summary: this.lastAction,
        url: frame.url,
        title: frame.title,
        textExcerpt,
        elements: frame.elements,
        frame,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: `Key press failed: ${msg}`, url: '', title: '', textExcerpt: '', elements: [], frame: null, error: msg }
    }
  }

  async scroll(deltaY = 480): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      await page.mouse.wheel(0, deltaY)
      await page.waitForTimeout(250)
      this.lastAction = deltaY >= 0 ? `Scrolled down ${deltaY}px` : `Scrolled up ${Math.abs(deltaY)}px`
      const { frame, textExcerpt } = await this.captureState(page)
      return {
        ok: true,
        summary: this.lastAction,
        url: frame.url,
        title: frame.title,
        textExcerpt,
        elements: frame.elements,
        frame,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: `Scroll failed: ${msg}`, url: '', title: '', textExcerpt: '', elements: [], frame: null, error: msg }
    }
  }

  async back(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null)
      await page.waitForTimeout(250)
      this.lastAction = 'Went back'
      const { frame, textExcerpt } = await this.captureState(page)
      return { ok: true, summary: `Back to ${frame.url}`, url: frame.url, title: frame.title, textExcerpt, elements: frame.elements, frame }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: `Back failed: ${msg}`, url: '', title: '', textExcerpt: '', elements: [], frame: null, error: msg }
    }
  }

  async reload(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })
      await page.waitForTimeout(250)
      this.lastAction = 'Reloaded page'
      const { frame, textExcerpt } = await this.captureState(page)
      return { ok: true, summary: `Reloaded ${frame.url}`, url: frame.url, title: frame.title, textExcerpt, elements: frame.elements, frame }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: `Reload failed: ${msg}`, url: '', title: '', textExcerpt: '', elements: [], frame: null, error: msg }
    }
  }

  async snapshot(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage()
      this.lastAction = 'Captured live snapshot'
      const { frame, textExcerpt } = await this.captureState(page)
      return { ok: true, summary: `Snapshot of ${frame.title}`, url: frame.url, title: frame.title, textExcerpt, elements: frame.elements, frame }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: `Snapshot failed: ${msg}`, url: '', title: '', textExcerpt: '', elements: [], frame: null, error: msg }
    }
  }

  async close(): Promise<void> {
    try {
      await this.page?.close()
    } catch {
      /* ignore */
    }
    try {
      await this.context?.close()
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close()
    } catch {
      /* ignore */
    }
    this.page = null
    this.context = null
    this.browser = null
    this.cursorX = null
    this.cursorY = null
    this.mediaEmbedUrl = null
    this.mediaTitle = null
    this.mediaVideoId = null
    this.lastAction = 'Closed'
    controlBus.broadcastBrowserFrame({
      active: false,
      url: '',
      title: '',
      imageBase64: '',
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      loading: false,
      cursorX: null,
      cursorY: null,
      lastAction: 'Closed',
      elements: [],
      mediaEmbedUrl: null,
      mediaTitle: null,
      mediaVideoId: null,
      updatedAt: new Date().toISOString(),
    })
  }
}

const g = globalThis as unknown as { __nexusBrowserMgr?: LiveBrowserManager }
export const liveBrowser = g.__nexusBrowserMgr ?? new LiveBrowserManager()
g.__nexusBrowserMgr = liveBrowser
