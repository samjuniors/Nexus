# GBrain port — attribution

This folder is a portable TypeScript port of the memory model of
[GBrain](https://github.com/garrytan/gbrain) by Garry Tan (MIT License),
merged into the NEXUS brain. The canonical upstream sources are vendored
at `vendor/gbrain/` for reference (excluded from compilation).

## What was ported, from where

| Port | Upstream source | What it does |
|---|---|---|
| `types.ts` | `src/schema.sql` | pages / entities / links / edges / retrievals model |
| `entities.ts` | `src/core/entities/{name-variants,near-name,resolve,resolve-on-save}.ts` | name-variant matching (normalized / honorific / reordered / diminutive / initial / typo / surname) with ranked matches, weak-match uniqueness, Damerau distance, corporate-suffix handling, nickname groups, and the save-time resolution cascade |
| `facts.ts` | `src/core/facts/{classify,claim-conflicts,capture-dedup}.ts` | typed claims (entity + metric + value), same-slot conflict detection, capture dedup, one-line truth compilation |
| `core-memory.ts` | `src/core/core-memory.ts` | the always-loaded tier: `alwaysLoad` pages rendered into every prompt under one character budget (default 4000), priority ordering, budget-enforced marking, core suggestions |
| `retrievals.ts` | `src/schema.sql` (`page_retrievals`) | the retrieval ledger — every recall recorded, recency-weighted use-attribution trust |
| `graph-ops.ts` | gbrain's manual-merge discipline | node inspect / create / rename / alias / remove / orphan prune — near-duplicates flagged, never silently merged |
| `remember.ts` | gbrain's write path | dedup → truth → conflict supersede → entity resolve → index |

## Deliberate differences

- gbrain is a standalone product (Postgres/PGlite engine, CLI, MCP server).
  This port keeps the **model and rules** and runs them against any host
  database through the `GBrainStore` interface.
- gbrain files conflict pairs as *proposals* for a human to accept. The brain
  here has no human review queue, so the newer fact **wins immediately** and
  the older page is marked `supersededBy` with its truth rewritten — the
  history is kept and readable, and recall stops serving the stale value.
- Entity near-matches (typo/surname) are flagged in `createNode` results and
  taught as aliases on save — the same "never silently merge" stance.

Upstream license: MIT — see `vendor/gbrain/LICENSE`. Version vendored: see
`vendor/gbrain/VERSION`.
