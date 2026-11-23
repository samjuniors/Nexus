# Nexus vs SamjuniorsOS — code-level comparison and selective port

Date: 2026-11-21 (UTC+05:30)
Status: **Provisional code audit; not a production acceptance**
Reviewer scope: authenticated GitHub repository snapshots only. Local machine was not online; no Electron, Android, end-to-end, CI, or real microphone tests ran.

## Exact audit inputs

- Nexus: [main @ 4e5e871a3202e07a766c6b7b9918ee85e3f78044](https://github.com/samjuniors/Nexus/commit/4e5e871a3202e07a766c6b7b9918ee85e3f78044).
- SamjuniorsOS: [main @ 2ec170534f4b154c4d9a07d8fc00e1575c9827c6](https://github.com/samjuniors/SamjuniorsOS/commit/2ec170534f4b154c4d9a07d8fc00e1575c9827c6).
- Also inspected SamjuniorsOS's separate kit/integration branch existence. Latest baseline is merged main; local uncommitted code is **NOT VERIFIED**.
- Nexus branch for changes: audit/samjuniorsos-selective-port-20261121.

## Decision

**Nexus is the more flexible candidate for a cross-device, portable-brain next-generation AI host. SamjuniorsOS currently has the more mature Windows desktop packaging, authorization model, CI/security checks, and test/operations infrastructure.** No evidence yet supports declaring Nexus a *safer* or *production-ready* replacement. Use Nexus as the prospective new base **after the P0 gates below**, rather than merging repositories.

| Dimension | Evidence and assessment |
|---|---|
| Portable cognition/graph | Nexus has a separable brain/ host contract with spine fallback, gbrain graph/entity/fact adapters and graph UI. Stronger modularity for a new portable-agent product. |
| Android and cross-device | Nexus has a native Android project, mobile foreground voice service, device bridge and responsive UI. Broader current surface. |
| Windows desktop operational depth | SamjuniorsOS has an Electron launcher, packaging scripts, vault, permission components, desktop recovery and a documented hardware QA process. Nexus's Electron folder is a lighter shell with a separate dependency manifest. |
| Enterprise/company workflows | SamjuniorsOS has explicit founder authority, side-effect authorization, audit and workflow invariants. Nexus offers organization/company functionality but not equivalent demonstrated enforcement. |
| Voice, vision, UX | Both implement voice/screen features. Nexus includes Eva camera/gaze and mobile UX; SamjuniorsOS includes Sofia voice-first desktop/permissions. Visual quality and real latency cannot be ranked from code alone. |
| Security | **SamjuniorsOS stronger architecturally**, though production posture requires independent tests. Nexus has unauthenticated privileged API routes in inspected code and network-wide default binding (see P0). |
| Testing and release discipline | SamjuniorsOS has a repo-wide test command, multiple suites, release/benchmark scripts and GitHub Actions CI. Nexus has targeted test scripts but no existing root test command/visible workflows at audit baseline. |

Repository file counts are not quality scores. Neither product has been freshly run or benchmarked for this comparison.

## Verified high-priority risks in Nexus at baseline

**P0 — Privileged HTTP endpoints lack a demonstrated authentication boundary.** In src/app/api/terminal/route.ts, POST accepts commands or device-pairing operations without a visible user/session check. src/app/api/computer-control/route.ts exposes folder/app policy mutation, device actions and screen snapshots. src/app/api/permissions/route.ts allows direct permission policy changes. src/app/api/tools/route.ts allows tool mutations. Server-side capability checks are not a substitute for authenticating the caller. A UI-only consent dialog is not a sufficient fix.

**P0 — Default server interface is 0.0.0.0.** server.ts sets hostname to 0.0.0.0. On reachable local or public networks, the above APIs may be exposed. Network firewall rules were not inspected. Android bridging needs a deliberate authenticated remote/LAN design; do not simply disable Android to hide this.

**P0 — WebSocket control stream authorization.** server.ts accepts /api/control and registers a UI client and permission decisions with no visible authentication before handling messages. Inspect /api/live and /api/device-bridge authentication separately before exposure. Bind approvals to authenticated session, run, immutable action payload and explicit expiry; reject replay and cross-actor approval.

**P1 — Previous native media permissions were broad.** Nexus Electron previously granted media and selected the first screen for getDisplayMedia without explicit native source selection. This branch ports a safer selection and native per-session microphone/camera consent; IPC screen snapshots and text injection now check sender and require native confirmation.

**P1 — Database push script accepted data loss.** Baseline npm run db:push included --accept-data-loss. Branch removes that flag. Separate migrations and backup/restore verification are still needed.

**P1 — Testing/CI/release.** No Nexus GitHub Actions workflow or comprehensive desktop QA was present in the inspected main tree. The new native permission tests require actual Node/Electron + Windows verification. Review Android foreground service privacy and pairing trust separately.

## Selectively ported on this draft branch

- electron/screen-vision-permissions.cjs: adapted from SamjuniorsOS/apps/desktop/screen-vision-permissions.cjs, adding invalid URL tolerance and Eva text. Explicit per-invocation native source choice, no audio.
- electron/media-permissions.cjs: SamjuniorsOS session-scoped microphone consent pattern adapted to separate Eva camera consent. Denies untrusted origins, unknown media kinds and camera/mic until approved.
- electron/main.cjs: plugs in native permissions; rejects cross-origin navigation and untrusted renderer IPC; adds native confirmation for on-demand snapshot and session-wide dictation paste. Explicit Alt+Space shortcut remains a user-triggered screen snapshot action and must be reviewed in UX.
- electron/media-permissions.test.cjs: eight focused tests for permission boundaries using Node test runner and mocked Electron session.
- package.json: new test:desktop-permissions command; db:push now refuses implicit destructive pushes.

The port retains Nexus's UI, portable brain, Android app, and current data; **nothing was copied from real user profiles, SQLite databases, passwords, provider tokens, or device pairing material**. SamjuniorsOS repository was not changed.

## Verification status

- Static JavaScript parsing of four changed Electron modules/test files: **PASS** in a V8 parser.
- Eight logic tests under a mocked V8 harness (with mocked URL, Electron session and Node test/assert built-ins): **8/8 PASS**.
- Real node --test, npm lint, TypeScript, Electron runtime, camera/microphone hardware, Windows packaging, Android and CI: **NOT RUN / NOT VERIFIED** (remote computer unavailable).
- No merge, release, deploy, secrets transfer, or production config change.

## Recommended migration sequence / release gates

1. **P0 first:** add authenticated local/remote HTTP and WebSocket ingress with origin/CSRF controls, scoped sessions, rate limiting and explicit device trust; avoid reliance on a renderer-controlled grant state. Fail closed. Validate against network/LAN adversaries and exposed routes.
2. **P0 first:** move terminal, browser, computer-control, plugin installation and device takeover through one deterministic policy/execution boundary with action hashes, bounded permissions and immutable audit. Adapt SamjuniorsOS SideEffectAuthorizationGate; do not blindly paste its Express/Vite backend into Nexus Next.js.
3. Prove permission port on Windows: run npm run test:desktop-permissions, Electron app + explicit native mic/camera/screen-choice checks, denied-origin tests and injection prompts. Check rendering and microphone worklets.
4. Port the **desktop release discipline** (vault/secure storage, crash recovery, single-instance, installer, Windows QA) from SamjuniorsOS as small independent adapters, not its whole desktop shell.
5. Port **voice-state resilience and one authority model** selectively: barge-in, mute/recovery, test fixture patterns; keep Eva design, Nexus brain and Android behavior.
6. Decide Nerve Connect integration through its published host adapter protocol. Do not merge duplicate Nerve Core/gbrain stores or assume Nexus's internal brain is Nerve Core.
7. Add Nexus CI: test, typecheck, lint, production build, dependency and secret scan, policy/approval tests, auth abuse tests, Android and Electron matrices.
8. Only then conduct side-by-side measured evaluation: task success, response latency, cold boot, memory recall correctness, audio uptime, idle CPU/RAM, startup recovery and security regression. Choose the successor after evidence, not repository age or file count.

**Human decision:** Retain both repositories. Nexus is the *candidate future base*, not an automatically approved replacement for SamjuniorsOS.

## 2026-11-21 follow-on security implementation delta

A subsequent **unmerged** draft-branch implementation adds a loopback-only owner gateway, production owner-session cookie and exact host/origin validation, login throttling, owner-authenticated WebSockets, capability checks on direct browser/mobile/terminal/desktop APIs, device receipt/socket binding, an Android↔desktop platform escalation block, non-destructive database push, fixed Caddy upstream, and a new CI workflow. Full details and remaining P0 gates are in [OWNER_ACCESS_AND_RELEASE_GATES.md](../security/OWNER_ACCESS_AND_RELEASE_GATES.md). The original baseline findings above remain historically accurate for Nexus main at commit 4e5e871; do not interpret them as a claim the draft changes are merged, deployed, or runtime-verified.

The user's explicit Nerve Core decision is a **future, separate integration**, documented in [NERVE_CORE_FUTURE_INTEGRATION.md](../architecture/NERVE_CORE_FUTURE_INTEGRATION.md); no Nerve Core code/memory is copied.
