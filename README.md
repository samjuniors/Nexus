# NEXUS AGENT

A real AI agent application: you give it a mission → an LLM plans it (chip, up to 6 steps, sub-agents) → it **actually executes** tools, skills, MCPs and plugins → then iterates and synthesizes the result. Chat + live step timeline, SQLite (Prisma) persistence, charcoal + silver theme.

```
Next.js 16 · TypeScript · Tailwind 4 · shadcn/ui · Prisma/SQLite · Zustand · z-ai-web-dev-sdk (GLM)
```

## The two brains

| Mode | What it is |
|---|---|
| **Brain OFF — Spine mode** | A normal, fully functional LLM application. Reflex routing, chat, tools, artifacts. |
| **Brain ON — NEXUS overlay** | The portable `brain/` folder takes over: reflex routing, graph memory with citations, dream cycles, app instructions, self-evolving coach. |

The entire "soul" of the agent lives in **`brain/`** — a portable, pluggable folder. Drop it into any host app that implements the `BrainHost` contract (`src/lib/agent/brain-host.ts`) and it works. Remove it and the app still runs in spine mode. See [brain/README.md](brain/README.md) for the full module map and research sources.

## Quick start

```bash
# 1. install (bun or npm)
bun install          # or: npm install

# 2. environment — everything is optional
cp .env.example .env # add external LLM keys if you have them; no keys = built-in GLM

# 3. database (SQLite, created on first push)
bun run db:push      # or: npm run db:push

# 4. run
bun run dev          # or: npm run dev  → http://localhost:3000
```

## LLM providers & fallback

The provider chain in `src/lib/agent/zai.ts` is:

```
OPENAI_API_KEY → ANTHROPIC_API_KEY → built-in GLM SDK (z-ai-web-dev-sdk)
```

- Any OpenAI-compatible endpoint works (OpenAI, OpenRouter, Groq, Together, DeepSeek, LM Studio, Ollama, vLLM) via `OPENAI_BASE_URL`.
- On any provider failure (network, 429, 5xx) the chain falls back down — **the app never goes dark**.
- The built-in GLM SDK needs no key; it is always the last resort.
- Optional `TAVILY_API_KEY` upgrades web search, falling back to the SDK search.

See `.env.example` for every variable.

## gbrain

`brain/gbrain/` vendors the upstream [gbrain](https://github.com/garrytan/gbrain) source (see `brain/gbrain/vendor/gbrain/` + `ATTRIBUTION.md`) and adapts it to TypeScript and the BrainHost contract: core memory pages, entity resolution (name variants, near-names), fact capture with dedup/superseding, claim conflicts, and deterministic graph growth. The graph is visualized in the Brain tab — **tear it off fullscreen** and hover any node to inspect it; nodes are created/removed automatically as the brain remembers and forgets.

## Tests

```bash
npx tsx scripts/test-gbrain.ts       # gbrain facts/entities/graph — 48 checks
npx tsx scripts/test-provider.ts     # provider + fallback chain
npx tsx scripts/test-twobrains.ts    # spine + NEXUS overlay E2E
npx tsx scripts/test-reflex.ts       # reflex routing — 40 checks
npx tsx scripts/test-graph-memory.ts # HippoRAG PPR + spreading activation
npx tsc --noEmit && npx eslint src brain
```

## Project structure

```
brain/                  ← the portable soul (pluggable into any host)
  core/                 cognition, coach, cache, refine, memory-graph,
                        recall, graph, dream, appcontrol, gate, capabilities
  gbrain/               vendored gbrain + TS adaptation
  index.ts, types.ts, manifest.json
src/
  app/api/agent/        start (SSE) / step / stop
  components/agent/     chat, brain view, gbrain graph (fullscreen), timeline…
  lib/agent/            orchestrator, brain-host, brain-runtime, zai,
                        gbrain-store, memory-graph-store, tools, seed
prisma/schema.prisma    Memory / MemoryEntity / MemoryLink / MemoryEdge /
                        BrainState / Suggestion / DreamCycle / Run / Step…
```

## Notes

- `brain/gbrain/vendor/gbrain/` keeps the upstream LICENSE — retain it if you fork.
- Runtime state (`db/`, `tool-results/`, `agent-workspace/`) is generated locally and git-ignored.
- Never commit your real `.env`; only `.env.example` belongs in git.
