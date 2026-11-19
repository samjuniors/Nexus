import sharp from 'sharp'

export interface ImageDimensions {
  width: number
  height: number
  sizeLabel: string
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
}

const SIZE_TO_DIMS: Record<string, ImageDimensions> = {
  '1024x1024': { width: 1024, height: 1024, sizeLabel: '1024x1024', aspectRatio: '1:1' },
  '1344x768': { width: 1344, height: 768, sizeLabel: '1344x768', aspectRatio: '16:9' },
  '768x1344': { width: 768, height: 1344, sizeLabel: '768x1344', aspectRatio: '9:16' },
  '1152x864': { width: 1152, height: 864, sizeLabel: '1152x864', aspectRatio: '4:3' },
  '864x1152': { width: 864, height: 1152, sizeLabel: '864x1152', aspectRatio: '3:4' },
  '1440x720': { width: 1440, height: 720, sizeLabel: '1440x720', aspectRatio: '16:9' },
  '720x1440': { width: 720, height: 1440, sizeLabel: '720x1440', aspectRatio: '9:16' },
}

const RATIO_TO_DIMS: Record<string, ImageDimensions> = {
  '1:1': SIZE_TO_DIMS['1024x1024'],
  '16:9': SIZE_TO_DIMS['1344x768'],
  '9:16': SIZE_TO_DIMS['768x1344'],
  '4:3': SIZE_TO_DIMS['1152x864'],
  '3:4': SIZE_TO_DIMS['864x1152'],
}

export function resolveImageDimensions(size?: string, aspectRatio?: string): ImageDimensions {
  const cleanSize = (size ?? '').trim().toLowerCase()
  if (cleanSize && SIZE_TO_DIMS[cleanSize]) {
    return SIZE_TO_DIMS[cleanSize]
  }
  const cleanRatio = (aspectRatio ?? '').trim()
  if (cleanRatio && RATIO_TO_DIMS[cleanRatio]) {
    return RATIO_TO_DIMS[cleanRatio]
  }
  return SIZE_TO_DIMS['1024x1024']
}

/**
 * Extract the `<svg>...</svg>` block from LLM output and strip any unsafe
 * active/external content before rasterizing with Sharp.
 */
export function extractAndSanitizeSvg(
  raw: string,
  dims: Pick<ImageDimensions, 'width' | 'height'>
): string | null {
  if (!raw || typeof raw !== 'string') return null
  const cleaned = raw.replace(/```(?:svg|xml|html)?/gi, '').replace(/```/g, '').trim()
  const match = /<svg\b[\s\S]*?<\/svg>/i.exec(cleaned)
  if (!match) return null

  let svg = match[0]
  // Remove dangerous elements & event handlers
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"(?:javascript:|https?:|data:)[^"]*"|'(?:javascript:|https?:|data:)[^']*')/gi, '')

  // Ensure root <svg> has xmlns, viewBox, width, and height
  const openTagMatch = /^<svg\b([^>]*)>/i.exec(svg)
  if (!openTagMatch) return null
  let attrs = openTagMatch[1]
  if (!/\bxmlns\s*=/i.test(attrs)) {
    attrs += ' xmlns="http://www.w3.org/2000/svg"'
  }
  if (!/\bviewBox\s*=/i.test(attrs)) {
    attrs += ` viewBox="0 0 ${dims.width} ${dims.height}"`
  }
  if (!/\bwidth\s*=/i.test(attrs)) {
    attrs += ` width="${dims.width}"`
  } else {
    attrs = attrs.replace(/\bwidth\s*=\s*(?:"[^"]*"|'[^']*')/i, `width="${dims.width}"`)
  }
  if (!/\bheight\s*=/i.test(attrs)) {
    attrs += ` height="${dims.height}"`
  } else {
    attrs = attrs.replace(/\bheight\s*=\s*(?:"[^"]*"|'[^']*')/i, `height="${dims.height}"`)
  }
  return svg.replace(/^<svg\b[^>]*>/i, `<svg${attrs}>`)
}

export async function rasterizeSvgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf-8'), { density: 144 }).png().toBuffer()
}

export function buildVectorIllustrationPrompts(
  prompt: string,
  dims: Pick<ImageDimensions, 'width' | 'height'>
) {
  const system = `You are an expert graphic designer and SVG vector illustrator.
Create a crisp, rich, layered, gallery-grade <svg> illustration matching the user's description.

REQUIREMENTS:
- Output ONLY a single valid <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.width} ${dims.height}" width="${dims.width}" height="${dims.height}">...</svg> element.
- No markdown fences, no commentary, no <script>, no <foreignObject>, no external image URLs.
- Use <defs> with <linearGradient>, <radialGradient>, soft opacity layers, highlights, ambient glow circles, and clean multi-part paths/shapes so the artwork looks rich and dimensional (not flat stick figures).
- Always render a full-bleed background <rect width="${dims.width}" height="${dims.height}" .../> that fits the mood of the prompt.
- Ensure all XML tags are properly closed and attributes are double-quoted.`

  const user = `Create an original SVG illustration (${dims.width}x${dims.height}) for:\n${prompt}`
  return { system, user }
}

export interface WikimediaImageHit {
  url: string
  caption?: string
}

export function parseWikimediaImageResponse(json: unknown, limit = 6): WikimediaImageHit[] {
  const pagesObj = (json as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages
  if (!pagesObj || typeof pagesObj !== 'object') return []

  const results: WikimediaImageHit[] = []
  for (const page of Object.values(pagesObj)) {
    const p = page as {
      title?: string
      imageinfo?: Array<{ url?: string; thumburl?: string; mime?: string }>
    }
    const info = p.imageinfo?.[0]
    if (!info) continue
    const mime = (info.mime ?? '').toLowerCase()
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
      continue
    }
    const url = info.thumburl || info.url
    if (!url || !/^https?:\/\//.test(url)) continue
    const caption = (p.title ?? '')
      .replace(/^File:/i, '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
    results.push({ url, caption: caption || undefined })
    if (results.length >= limit) break
  }
  return results
}
