// Direct test of the chart SVG builder via the compiled tool path
import { buildChartSvg } from './chart-helper'

const bar = buildChartSvg({ title: 'Test Bar Chart', type: 'bar', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], values: [12, 19, 7, 15, 22] })
const line = buildChartSvg({ title: 'Test Line Chart', type: 'line', labels: ['Jan', 'Feb', 'Mar', 'Apr'], values: [3, 8, 4, 11] })
const pie = buildChartSvg({ title: 'Test Pie Chart', type: 'pie', labels: ['Alpha', 'Beta', 'Gamma'], values: [45, 30, 25] })

for (const [name, svg] of [['bar', bar], ['line', line], ['pie', pie]] as const) {
  const valid = svg.startsWith('<svg') && svg.endsWith('</svg>')
  const hasTitle = svg.includes('Test')
  const elements = (svg.match(/<(rect|circle|polyline|path|text|line)/g) ?? []).length
  console.log(`${name}: valid=${valid} hasTitle=${hasTitle} elements=${elements} bytes=${svg.length}`)
  if (!valid || !hasTitle || elements < 5) {
    console.error(`${name} chart FAILED`)
    process.exit(1)
  }
}
console.log('ALL CHARTS PASS')
