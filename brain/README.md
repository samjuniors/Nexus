# Nexus Brain

A **completely modular intelligence module** — the smart overlay brain ("spirit") for agent apps that already have a working spine.

## The two-brain model

This app deliberately runs with TWO brains:

| | Spine brain (in the host app) | NEXUS brain (this folder) |
|---|---|---|
| What | The standard agent loop: LLM routing, planning, tool execution, synthesis, memory | A pluggable cognition overlay |
| Always on? | Yes — it is the app itself | No — connect / disconnect at will |
| Adds | A normal "LLM + skills + plugins" agent app | Reflex routing, recall with citations, knowledge graph, dream cycles, app directives, follow-up chips |

- **Connected** — the SAME app gets smarter: the brain takes over routing (reflexes + a fast router turn), recalls memories with numbered citations, feeds mission planners brain context, dreams over its memories, and steers the whole app through its directives (chat tone, mission verbosity, auto-dream).
- **Disconnected** — the app keeps working like any normal LLM agent app: the spine routes every message with its own LLM turn, missions plan and run, tools execute, memories persist. You only lose the overlay: no recall citations, no graph intelligence, no dream, no directives, no follow-up chips.
- **Reconnected** — the overlay snaps back instantly; nothing was deleted.

The brain holds **zero app-specific imports**. Drop this folder into any TypeScript app, provide the `BrainHost` adapter, and the app gains a second, smarter brain.

## Folder layout

```
brain/
├── manifest.json              # brain identity + capability contract + guarantees
├── types.ts                   # BrainHost adapter contract, route decisions, app prefs
├── index.ts                   # createBrain(host) — the single public entry point
└── core/
    ├── gate.ts                # connect / disconnect / status + app-directive storage
    ├── cognition.ts           # ACT 1 think(): reflex + fast router (chat vs task)
    │                          # ACT 2 answerMessages(): prompt for the STREAMED answer
    ├── appcontrol.ts          # the brain's control surface over the whole host app
    │                          #   (tone, mission verbosity, auto-dream → prompt directives)
    ├── capabilities.ts        # capability inventory of the host body
    ├── recall.ts              # human-brain recall: GenAgents scoring (recency ×
    │                          #   importance × relevance), Bjork storage/retrieval
    │                          #   strengths, priming across turns, pattern completion,
    │                          #   numbered citations
    ├── memory-graph.ts        # HippoRAG-style GRAPH MEMORY: entity/triple extraction
    │                          #   (deterministic, zero LLM), spreading activation,
    │                          #   Personalized PageRank, token-budgeted graph recall,
    │                          #   associative rabbit holes
    ├── graph.ts               # knowledge graph (graphify): EXTRACTED / INFERRED /
    │                          #   AMBIGUOUS edges, communities, surprising connections,
    │                          #   god nodes, suggested questions, graph report
    ├── coach.ts               # the COACH: Reflexion reviews after missions, lesson
    │                          #   injection before missions, use-attributed grading
    │                          #   (helpful lessons gain weight, harmful ones decay),
    │                          #   teachFact() for user-taught knowledge
    ├── cache.ts               # TOKEN ECONOMY: LRU+TTL context cache with token-saving
    │                          #   stats, cache-friendly prompt layout discipline
    ├── refine.ts              # prompt refinement: decontextualizing rewrite of
    │                          #   follow-ups, deterministic query expansion,
    │                          #   one-round self-refine
    └── dream.ts               # dream cycle: duplicate merging, relation sensing,
                               #   insight distillation + auto-dream gate

gbrain/                         # THE GBRAIN MEMORY MODEL — port of garrytan/gbrain
├── ATTRIBUTION.md            # what was ported from where (MIT, upstream vendored)
├── vendor/gbrain/            # canonical upstream sources — reference only,
│                          #   excluded from tsc + ESLint
├── types.ts                  # page/entity/edge model + GBrainStore contract
│                          #   (the host implements persistence; the brain decides)
├── entities.ts               # entity resolution: name variants (normalized /
│                          #   honorific / reordered / diminutive / initial / typo /
│                          #   surname), near-name FLAGGING, save-time cascade
├── facts.ts                  # typed claims, conflict supersede, capture dedup,
│                          #   one-line truth compilation
├── core-memory.ts            # the always-loaded tier: alwaysLoad pages rendered
│                          #   into EVERY prompt under a 4000-char budget
├── retrievals.ts             # retrieval ledger + use-attribution trust
├── graph-ops.ts              # node inspect / create / rename / alias / remove /
│                          #   orphan-prune (auto + manual, never silent merges)
└── remember.ts               # the write path every memory flows through:
                           #   dedup → truth → conflicts → resolution → index
```

## Plugging the brain into any app

Provide a host adapter with four things — language model access, durable state storage, a capability snapshot, and a clock:

```ts
import { createBrain } from '@/brain' // wherever you place this folder

const brain = createBrain({
  llm: {
    complete: async (messages, opts) => callYourLlm(messages, opts),
  },
  state: {
    get: async () => yourStore.get('brain'), // { connected, personality, appPrefs? }
    set: async (patch) => yourStore.set('brain', patch),
  },
  capabilities: async () => ({
    tools: yourTools,      // [{ slug, name, description }]
    skills: yourSkills,
    plugins: yourPlugins,
    mcps: yourMcps,
    memoryCount: yourMemories.length,
  }),
  now: () => new Date(),
})
```

Then use it as the front door of your chat (streaming-friendly):

```ts
if ((await brain.status()).connected) {
  const route = await brain.think({ message, history, memories }) // routing ONLY — fast

  if (route.kind === 'chat') {
    // brain builds the persona prompt (memories + recall + tone directive);
    // the HOST streams it token-by-token → the answer appears as if typed
    const msgs = await brain.answerMessages({ message, history, memories }, route.recalled)
    const answer = await streamYourLlm(msgs)          // emit tokens as they arrive
    return { answer, recalled: route.recalled }       // citations for the UI
  }
  return runFullAgentMission()                        // escalate: planning + tools + subagents
}
// brain disconnected → your app's own spine handles it (never go dumb)
return routeWithYourOwnLlm()
```

## How the brain decides

1. **Deterministic reflexes** (no LLM): requests that obviously need tools — image generation, voice, translation, code execution, file operations, live research — escalate to agent mode instantly. Pure clock questions ("what's the date today?") are exempt: they answer instantly from the prompt's own authoritative date line.
2. **One small router turn**: everything else gets a single cheap routing call that answers ONLY "chat or task?" — it never writes the answer itself, so the real answer can be STREAMED next.
3. **Streamed composition**: for chat, `answerMessages()` builds the full persona prompt (body capabilities, memory, recalled citations, tone directive) and the host streams it — short answers type out in a blink, long answers take as long as they deserve.

## App control (the brain steers the whole app)

While connected, the brain issues directives stored in its own state and honored app-wide:

- `tone` — concise / balanced / thorough, applied to every streamed chat answer
- `missionVerbosity` — brief / balanced / detailed, applied to every mission's final report
- `autoDream` — whether dream cycles may run automatically

Disconnect the brain and the app reverts to its default behavior — the directives are preferences, not damage.

## The gbrain memory model (ported, complete)

The whole memory architecture of [gbrain](https://github.com/garrytan/gbrain) (MIT) is ported into `brain/gbrain/` — the canonical upstream sources are vendored at `gbrain/vendor/gbrain/` for reference, and `gbrain/ATTRIBUTION.md` maps every port to its origin. All of it lives in the portable brain folder; the host only implements `GBrainStore` (persistence against its own database).

- **The write path** (`remember.ts`) — every memory in the host app flows through `gbrainRemember()`: capture dedup (a near-duplicate REFRESHES the original instead of adding noise) → one-line truth compilation → typed-claim conflict supersede ("Maria works at Stripe now" marks "Maria works at Zalando" superseded — history kept, stale values stop being served, the page leaves the core tier) → entity resolution.
- **Entity resolution** (`entities.ts`) — names arrive in many shapes; the ranked variant matcher handles normalized / honorific / reordered ("Example, Alice") / diminutive ("Allie" ≡ "Alice") / initial ("A. Example") / typo (Damerau-1: "ACMX" ≡ "ACME") / surname matches, with corporate suffixes ("ACME Labs" ≡ "ACME Inc") not distinguishing organizations. Weak matches resolve only when unique — a near-name never silently becomes a different entity; `createNode` flags them with a hint instead.
- **Core memory** (`core-memory.ts`) — pages marked `alwaysLoad` render into EVERY prompt under one character budget (default 4000). Deterministic, zero LLM. Marking refuses when the tier is full; superseded truths drop out automatically.
- **The retrieval ledger** (`retrievals.ts`) — every recall is recorded; recency-weighted trust means memories that keep being used are the ones the brain trusts.
- **Graph ops** (`graph-ops.ts`) — the interactive surface: node inspect / create / rename (old name becomes an alias) / alias / remove (memories survive, unlinked) / orphan-prune. The brain auto-creates nodes from memory text and auto-prunes orphans after dreaming; a person can do all of it by hand too (nodes carry `origin: auto | manual`).

## Memory — three layers, human-brain inspired

Research on human memory (Atkinson-Shiffrin stores, Generative Agents recall, Bjork's New Theory of Disuse, hippocampal index theory / HippoRAG) shaped three cooperating layers:

1. **Working memory** — the current conversation window passed to every prompt.
2. **Recall layer** (`recall.ts`) — every incoming message is scored against long-term memories: recency `0.995^Δh` × importance (salience 1–10 tagged at write) × relevance (multi-query keyword fusion), min-max normalized (the Generative Agents formula). Storage strength and retrieval strength are tracked separately (Bjork): successful hard recalls strengthen a memory most — desirable difficulty. A priming map carries activation across turns; pattern completion fills weak cues from matched key terms (CA3-style). Facts and decisions outrank casual notes. The best matches enter the answer prompt and travel with it as numbered citations — answers with citations, not chunks.
3. **Graph layer** (`memory-graph.ts`) — every memory is parsed into entities and typed triples (deterministic, zero LLM at index time) and indexed into an entity-relation graph. Recall seeds the graph with the query's entities and runs **Personalized PageRank** (HippoRAG) under an explicit **TOKEN BUDGET** — only the activated subgraph's tokens ever enter a prompt. That is the "answers quickly without burning tokens" guarantee: multi-hop connections surface in one computation instead of scanning and re-reading every memory. Edges carry EXTRACTED/INFERRED provenance (graphify).

- **Dream cycle** (`dream.ts`): consolidation — `planDream()` merges near-duplicates, senses latent relations for the graph and (via the host LLM) distills old memories into compact insights. `shouldAutoDream()` gates gbrain's 24/7 behaviour (30-minute cooldown).
- **Rabbit holes**: `rabbitHole()` hops outward from a topic entity preferring surprising edges (INFERRED + low-degree destinations) — associative deep-dives with a map back.

## The coach (self-teaching loop)

The coach is the brain's built-in teacher — it makes the brain improve with every mission:

1. **Review** (after every mission): a Reflexion turn reflects on what worked and what wasted steps → at most 2 concrete lessons stored as procedural memories.
2. **Inject** (before every mission): the top-k lessons whose origin goal resembles the new task are injected into the planner prompt as advice.
3. **Grade** (use-attributed feedback): lessons that rode a successful mission gain weight `w ← w + α(1−w)`; lessons that rode a failure decay `w ← w(1−α)`. Low-weight lessons stop being injected and are eventually pruned — the brain keeps what helps.
4. **Teach** (`teachFact()`): user-taught knowledge ("remember that I take coffee black") is normalized into high-salience memories and indexed into the graph immediately.

## Token economy

- **Context cache** (`cache.ts`): an in-memory LRU with TTL caches routing decisions and other deterministic outputs — identical messages re-route for zero tokens. Stats (hit rate, tokens saved) are exposed to the UI. Prompt layout follows a stable discipline — static persona → stable lists → stable memory → append-only history → volatile tail — so provider KV-caches stay valid across turns.
- **Prompt refinement** (`refine.ts`): decontextualization rewrites follow-ups ("and his sister?") into standalone queries before recall so the graph seeds the right entities; deterministic query expansion fuses variants; one-round self-refine polishes planning artifacts. All best-effort — the original message is always a fine query.

## Knowledge graph (graphify-inspired)

- Every node (tools, skills, plugins, MCPs, memories, conversations, runs, artifacts) and every edge is built deterministically from app data — zero LLM calls.
- **Edge provenance**: EXTRACTED (straight from data), INFERRED (strong co-occurrence ≥ 30%), AMBIGUOUS (weak 18–30%) — graphify's transparency model.
- **Queries**: `queryNeighbors`, `queryPath` (BFS), stats — the same three modes graphify exposes.
- **Graph report**: `buildGraphReport()` returns god nodes (degree hubs), memory communities (label propagation), surprising connections (edges bridging separate clusters) and suggested questions derived from structure.

## Guarantees

- Disconnecting the brain **never** deletes or disables host capabilities.
- A disconnected brain is simply **never consulted** — the host spine answers with full LLM power; the app never goes dumb.
- The brain never imports from the host app; integration happens only through `BrainHost`.

## Credits

Ideas borrowed with gratitude: **gbrain** (garrytan) — cited synthesis, typed knowledge priority, dream consolidation, brain-drives-the-body directives, use-attributed feedback. **graphify** (Graphify-Labs) — edge provenance tiers, deterministic-first graph building, god nodes / communities / surprising connections, graph reports. **HippoRAG** — Personalized PageRank over a memory index for multi-hop, budgeted recall. **Generative Agents** (Park et al.) — the recency × importance × relevance recall formula. **Bjork's New Theory of Disuse** — storage vs retrieval strength and desirable difficulty. **Reflexion** (Shinn et al.) — verbal self-reflection turned into lessons. And the "Rabbit" inspiration — LAM-style models that learn to operate software by watching — lives on in the rabbit-hole associative walks and the computer-use tool.
