/** WMO weather interpretation codes → human description (Open-Meteo docs). */
const WMO_WEATHER: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snow fall',
  73: 'moderate snow fall',
  75: 'heavy snow fall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail',
}

/** Chart palette — silver-on-charcoal theme matching the app. */
const CHART_COLORS = ['#7dd3fc', '#6ee7b7', '#f0abfc', '#fcd34d', '#fdba74', '#a5b4fc', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe', '#fde68a', '#5eead4']

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
  )
}

/**
 * Build a clean SVG chart (bar / line / pie) — zero dependencies, saved as a
 * workspace artifact. Charcoal background, silver text, palette accents.
 */
export function buildChartSvg(opts: { title: string; type: 'bar' | 'line' | 'pie'; labels: string[]; values: number[] }): string {
  const { title, type, labels, values } = opts
  const W = 760
  const H = 480
  const bg = '#131419'
  const fg = '#e4e4e7'
  const muted = '#a1a1aa'
  const grid = 'rgba(255,255,255,0.07)'
  const maxV = Math.max(...values)
  const minV = Math.min(...values, 0)
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, monospace">`)
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}" rx="14"/>`)
  parts.push(`<text x="${W / 2}" y="42" text-anchor="middle" fill="${fg}" font-size="19" font-weight="600">${escapeXml(title)}</text>`)

  if (type === 'pie') {
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const cx = 250
    const cy = 265
    const r = 145
    let angle = -Math.PI / 2
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total
      const a2 = angle + frac * Math.PI * 2
      const large = frac > 0.5 ? 1 : 0
      const x1 = cx + Math.cos(angle) * r
      const y1 = cy + Math.sin(angle) * r
      const x2 = cx + Math.cos(a2) * r
      const y2 = cy + Math.sin(a2) * r
      if (frac > 0.999) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`)
      } else if (frac > 0.001) {
        parts.push(
          `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${CHART_COLORS[i % CHART_COLORS.length]}" stroke="${bg}" stroke-width="2"/>`
        )
      }
      angle = a2
    })
    // legend
    const legendX = 470
    values.forEach((v, i) => {
      const y = 130 + i * 34
      parts.push(`<rect x="${legendX}" y="${y - 11}" width="14" height="14" rx="3" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`)
      parts.push(
        `<text x="${legendX + 24}" y="${y}" fill="${fg}" font-size="14">${escapeXml(labels[i].slice(0, 22))} <tspan fill="${muted}">${fmt(v)} (${((Math.max(0, v) / total) * 100).toFixed(0)}%)</tspan></text>`
      )
    })
  } else {
    const L = 70 // left margin
    const R = 30
    const T = 80
    const B = 70
    const plotW = W - L - R
    const plotH = H - T - B
    const span = maxV - minV || 1

    // gridlines + y labels (5 steps)
    for (let g = 0; g <= 4; g++) {
      const y = T + plotH - (g / 4) * plotH
      const val = minV + (g / 4) * span
      parts.push(`<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${grid}" stroke-width="1"/>`)
      parts.push(`<text x="${L - 10}" y="${y + 4}" text-anchor="end" fill="${muted}" font-size="11">${fmt(Math.round(val * 10) / 10)}</text>`)
    }

    if (type === 'bar') {
      const slot = plotW / values.length
      const bw = Math.min(72, slot * 0.62)
      values.forEach((v, i) => {
        const h = ((v - minV) / span) * plotH
        const x = L + slot * i + (slot - bw) / 2
        const y = T + plotH - h
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="4" fill="${CHART_COLORS[i % CHART_COLORS.length]}" fill-opacity="0.88"/>`)
        parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" fill="${fg}" font-size="12">${fmt(v)}</text>`)
        parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${T + plotH + 20}" text-anchor="middle" fill="${muted}" font-size="11">${escapeXml(labels[i].slice(0, 12))}</text>`)
      })
    } else {
      // line
      const pts = values.map((v, i) => {
        const x = L + (values.length === 1 ? plotW / 2 : (i / (values.length - 1)) * plotW)
        const y = T + plotH - ((v - minV) / span) * plotH
        return { x, y }
      })
      parts.push(`<polyline points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#7dd3fc" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)
      pts.forEach((p, i) => {
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#7dd3fc" stroke="${bg}" stroke-width="2"/>`)
        parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" fill="${fg}" font-size="12">${fmt(values[i])}</text>`)
        parts.push(
          `<text x="${p.x.toFixed(1)}" y="${T + plotH + 20}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" fill="${muted}" font-size="11">${escapeXml(labels[i].slice(0, 12))}</text>`
        )
      })
    }
  }

  parts.push(`<text x="${W / 2}" y="${H - 16}" text-anchor="middle" fill="${muted}" font-size="10" fill-opacity="0.7">nexus agent · create_chart</text>`)
  parts.push('</svg>')
  return parts.join('\n')
}

