# Vendored GBrain reference sources

Trimmed clone of [garrytan/gbrain](https://github.com/garrytan/gbrain)
(MIT License — see LICENSE; upstream version in VERSION) vendored on
2026-11-17 as the canonical reference for the GBrain memory model ported
into `brain/gbrain/`.

Included (the modules that define gbrain's memory architecture):

- `DESIGN.md` — the architecture document
- `src/schema.sql` — pages / facts / entities / links / retrievals schema
- `src/core/core-memory.ts` — the always-loaded core memory tier (char budget)
- `src/core/cycle.ts` — the dream/consolidation cycle
- `src/core/facts/` — typed-claim classification, conflict (supersede) detection,
  capture dedup, attribution
- `src/core/entities/` — name variants, near-name detection (same/typo/acronym),
  resolve-on-save
- `src/core/link-extraction.ts`, `link-relationships.ts` — page/entity link model

Not vendored: the engine (Postgres/PGlite), CLI, MCP server, connectors,
tests, docs assets — gbrain is a standalone product; this repo ports its
memory model as portable TypeScript inside `brain/gbrain/`.

These files are REFERENCE ONLY — excluded from tsc and ESLint; they import
gbrain's engine and will not compile here. The working port lives in
`brain/gbrain/*.ts`.
