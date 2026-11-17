import { exploreRabbitHole, graphRecallMemories, loadMemoryGraph } from '../src/lib/agent/memory-graph-store'
import { spreadingActivation, personalizedPageRank, seedEntities } from '../brain/core/memory-graph'

async function main() {
  // 1. rabbit hole from Maria
  console.log('=== RABBIT HOLE (topic: Maria) ===')
  console.log(await exploreRabbitHole('Maria'))

  // 2. graph recall for a query that needs the graph
  console.log('\n=== GRAPH RECALL (query: "who uses python?") ===')
  const r = await graphRecallMemories('who uses python', { limit: 3, tokenBudget: 400 })
  for (const m of r.recalled) {
    console.log(` [${m.cite}] (${m.type}) ${m.content.slice(0, 80)} — via ${m.trail.join(' → ')}`)
  }

  // 3. graph recall via User hub
  console.log('\n=== GRAPH RECALL (query: "what do I prefer?") ===')
  const r2 = await graphRecallMemories('what do I prefer', { limit: 3, tokenBudget: 400 })
  for (const m of r2.recalled) {
    console.log(` [${m.cite}] (${m.type}) ${m.content.slice(0, 80)} — via ${m.trail.join(' → ')}`)
  }

  // 4. raw activation demo
  console.log('\n=== SPREADING ACTIVATION (seed: python) ===')
  const graph = await loadMemoryGraph()
  const seeds = seedEntities(graph, 'python')
  for (const [id, w] of seeds) {
    const node = graph.nodes.get(id)
    console.log(` seed: ${node?.name} (weight ${w.toFixed(2)})`)
  }
  const ppr = personalizedPageRank(graph, seeds)
  const sorted = [...ppr.activation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  for (const [id, act] of sorted) {
    console.log(` activated: ${graph.nodes.get(id)?.name} (${act.toFixed(4)})`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
