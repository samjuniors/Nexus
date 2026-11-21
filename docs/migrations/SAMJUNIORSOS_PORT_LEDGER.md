# SamjuniorsOS → Nexus selective migration ledger

**Updated:** 2026-11-21. **Source repositories stay separate.** Source for SamjuniorsOS references: main at 2ec170534f4b154c4d9a07d8fc00e1575c9827c6. Nexus draft: audit/samjuniorsos-selective-port-20261121 / PR #1. Revalidate live refs before work.

## Transfer status

| Capability | Decision | Nexus code / status |
|---|---|---|
| Native microphone/screen permission | Adapted | electron/media-permissions.cjs, electron/screen-vision-permissions.cjs; UI consent + isolated tests (hardware not verified) |
| Trusted Electron IPC and snapshot consent | Adapted | electron/main.cjs; user approval and sender checks, Windows QA pending |
| Server authorization boundaries | Adapted concept | security/owner-gateway.cjs, server.ts; production owner token, HTTP/WS host/origin/session checks (live security test pending) |
| Cryptographic action approval binding | Adapted | src/lib/agent/action-binding.ts inspired by SamjuniorsOS payload-binding; action hashes in permission queue and browser/mobile/shell/desktop, self-heal and agent tool paths; tests added |
| Scoped high-risk approvals | Adapted | src/lib/agent/permission-policy.ts; previous unlimited Always grants for shell/mobile/desktop/self-install/self-heal now treated as Ask, UI reflects restriction |
| Per-platform device dispatch | Nexus hardening | src/lib/agent/control-bus.ts; rejects unregistered capability and batch rename; bridge receipt verification and platform matching |
| SQLite disaster recovery | Bounded adaptation | scripts/offline-backup.mjs; offline-only, explicit acknowledgement, checksums/manifest; no online snapshot or restore yet |
| Security test/CI discipline | Partially ported | tests and .github/workflows/security.yml; CI run previously failed without useful logs, **not passed** |
| Windows startup, installer, provider vault | Pending | Requires Windows test machine and review of secure storage and packaged process lifecycle; do not copy profile secrets |
| Voice barge-in, mic recovery, dynamic presence | Review pending | Nexus already has voice/live-session, wake and Eva stage; port only verified fixes, not Sofia components wholesale |
| Workflow approval, durable audit, idempotency | Partial only | Current per-action prompt/audit is not a complete distributed workflow transaction, cross-process lease or immutable audit chain |
| Production filesystem containment / sandbox | **P0 pending** | Companion scripts still need realpath + symlink/junction escape and TOCTOU testing; no production remote writes accepted |
| UI design | Preserve Nexus | Do not overwrite Eva/Nexus React/UI kit with SamjuniorsOS's Sofia or Nocturne UI |
| Nerve Core / Nerve Connect | **DEFERRED** | One active brain authority, adapter-only future concept. No Nerve code/data merged |

## Where migration is deliberately conservative

1. No bulk copying, replacing Nexus Next.js with SamjuniorsOS's Express/Vite, or replacing Nexus Android WebView with unrelated OS screens.
2. No real data, API keys, database files, device pairing tokens or profile directories copied.
3. No merge to main until proper Windows/Android/Node/CI acceptance.
4. No automatic restore, payments, browser destructive actions or unbounded agent privileges.
5. No Nerve Core integration until a separate approved milestone.

## Remaining P0/P1 migration sequence

**P0 — Action authority:** Audit all direct model tools, REST endpoints, WebSocket functions, automation scheduler and device transport to ensure deterministic authentication, action-bound capability authorization, fail-closed audit, replay protection and idempotent execution. Existing grant policy and in-memory queues are not enough for production.

**P0 — Remote computer safety:** Secure companion path resolution against symlinks/junctions, enforce filesystem writes at the host with revalidation, verify device revocation and command receipt integrity, and test network/HTTPS conditions.

**P1 — Windows foundation:** Bring over tested portions of SamjuniorsOS native provider vault, startup recovery, single-instance handling and Windows packaging. Keep Nexus product design and Electron process model.

**P1 — Voice resilience:** Compare real microphone/worklet/Live voice behavior and port tested mute, barge-in and reconnection logic only when it improves Nexus without duplicating the brain.

**P1 — Data and recovery:** Prove real SQLite offline backups and isolated restore drills, then design safe online backups and retention.

**P1 — AI Studio Build:** Follow docs/AI_STUDIO_BUILD_HANDOFF.md, preserve the reviewed commit and source-of-truth repo, and verify Android/Web separately from Windows Electron.

## Exact verification limits for this drafting session

No connected workstation was available. Prior mocked V8 checks for 11 owner gateway cases and 8 native consent cases passed at their previous reviewed snapshots. **New action hash, policy, tool routing, backup tests, full TypeScript/Next build and all real platform tests are NOT VERIFIED** in Node/Windows/Android. GitHub Actions previously recorded a failed workflow with no readable steps; do not claim green CI. Review every commit and run the scripts on a disposable machine before merging.

### Safe commands for a reviewer

- npm run test:security
- npm run test:recovery
- npm run typecheck
- npm run lint
- npm run build

No real secrets, production DB or live credentials are needed for these scripted fixture checks.
