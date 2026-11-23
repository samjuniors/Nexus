# Nexus — Agent Engineering Guardrails

This file applies to Claude Code, ChatGPT, Codex, Antigravity and any other coding agent contributing to Nexus.

## Product and source of truth

- Nexus is a separate AI agent/desktop/Android host with its own Eva UX, portable brain/ cognition and gbrain, Next.js server and Electron shell. **Do not overwrite Nexus with SamjuniorsOS.**
- Source priority: current authorized local working tree (including uncommitted work) → live branch/PR metadata → code and tests → architecture/audit documents → chat summaries. Never assume GitHub main is newer than a connected local worktree.
- Verify exact Git branch, HEAD SHA, clean/dirty status and open PRs at every handoff. Do not invent tests, readiness or completion statuses.
- Security defaults are deliberate: loopback-only server binding, owner-authenticated production access, separate device pairing and capability permission checks. Do not bypass these for demos.
- Do not copy secrets, device tokens, environment files, SQLite/Prisma data, user-profile files or provider credentials from SamjuniorsOS, Nerve Core or another machine. Use fixtures only.
- Changes are made on bounded review branches/draft PRs, not by directly force-pushing main. Do not merge, tag, deploy or release without explicit owner approval and acceptance evidence.

## Current project decisions (2026-11-21)

1. **Nexus is a promising potential successor, not a verified replacement** for SamjuniorsOS. Read docs/audits/NEXUS_VS_SAMJUNIORSOS_2026-11-21.md.
2. Port valuable code and governance patterns selectively, preserving Eva's UX, Nexus's own brain and native Android integration.
3. **Nerve Core + Nexus portable brain integration is explicitly postponed.** Read docs/architecture/NERVE_CORE_FUTURE_INTEGRATION.md. Do not touch Nerve Core or implement a merger until owner authorizes.
4. Preserve a single action authority and prevent multiple competing memory writers. Model decisions never bypass deterministic side-effect permissions.
5. Security draft: audit/samjuniorsos-selective-port-20261121, Nexus PR #1. Changes are **not production-accepted**. Details: docs/security/OWNER_ACCESS_AND_RELEASE_GATES.md.

## Mandatory verification

- npm run test:security
- npm run typecheck
- npm run lint
- npm run build
- Windows Electron explicit microphone/camera/screen permission and IPC tests
- Android WebView owner session, USB forwarding and trusted HTTPS proxy tests
- Device pairing, revocation, platform mismatch, forged command-result, symlink escape, hostile-origin and privilege escalation tests
- Secret and dependency scans, actual installed application packaging and independent security review

**Current evidence:** static JavaScript parsing and mocked-V8 permission tests ran during ChatGPT development; live Node, CI, Windows/Electron/Android/device tests were not accessible. Never relabel mocked tests as actual runtime tests.

## Known blockers

- Owner capability approvals require cryptographic action payload binding, expiry/idempotency and durable fail-closed audit.
- Companions must resolve actual filesystem paths/symlinks/junctions and enforce action-specific write constraints against races.
- Session/WS, device replay, token rotation, native WebView and reverse proxy tests need real environment evidence.
- Audit every alternate direct tool execution path; route-level permissions alone do not prove agent-initiated side effects are governed.
- Production packaging, release gates and UI regression must be validated before Nexus becomes the primary product.

Use docs/HANDOFF_2026-11-21.md for the current implementation handoff and revalidate live GitHub before continuing.


## Latest migration state

Read docs/migrations/SAMJUNIORSOS_PORT_LEDGER.md before selecting features to port. The Node/TypeScript action-hash, client-safe high-risk policy metadata, exact-action server/tool authorization, offline-only backup and AI Studio handoff have been committed to the draft PR, but their new unit tests and full build have not yet run in a real Node environment. Never claim that a source port or an AI Studio preview is production acceptance.
