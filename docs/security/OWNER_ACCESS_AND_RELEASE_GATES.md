# Nexus Owner Access & Network Security

Status: draft hardening introduced 2026-11-21. **Not production-approved; full Windows/Android/runtime and penetration tests are pending.**

## Default ingress

- Nexus now binds to `127.0.0.1` (or another loopback address explicitly set in `NEXUS_BIND_HOST`). A request to bind `0.0.0.0` or a LAN interface fails at startup.
- Local **development only** can run without an owner token on the direct loopback socket. This is convenient, **not protection against malicious code running on the same PC**. Run with a token if local hostile processes are in scope.
- All API routes and control/Live WebSocket upgrades are protected *before* Next.js routing by `security/owner-gateway.cjs`.
- Production and all `NEXUS_PUBLIC_ORIGIN` deployments require `NEXUS_OWNER_TOKEN`, 32–512 characters. Production fails closed when it is missing.
- The owner enters the token at `/access`. The login flow issues a short-lived (12-hour), signed, HttpOnly, SameSite=Strict session cookie with `Secure` for HTTPS origins. No URL-token login is offered.
- Unsafe HTTP methods require exact same-origin `Origin` headers. Host and Fetch Metadata checks reject cross-site requests. Brute-force login attempts are throttled. Sessions are rotated on restart; logout explicitly revokes a session for the current server process.
- `GET /api/health` remains a limited unauthenticated readiness endpoint.
- Native `/api/device-bridge` connections still use the separate strong, hashed pairing token. That path **does not** grant owner UI or API authority.

## Setup

Generate a unique private token using your local terminal; keep it out of screenshots and Git:

```bash
node -e "console.log(require('node:crypto').randomBytes(36).toString('base64url'))"
```

Set `NEXUS_OWNER_TOKEN` in the private local `.env` or your process secret manager. It must never be prefixed `NEXT_PUBLIC_`. The server calls Next.js `loadEnvConfig` before enforcing the gateway configuration.

For a private desktop-only service, use `http://127.0.0.1:3000`, and log in at `/access` when the token is configured. The two loopback aliases (`localhost` and `127.0.0.1`) create separate browser cookie origins; use a consistent address.

For phone access:
- **USB Android / ADB**: `adb reverse tcp:3000 tcp:3000`; the Android WebView can open `http://127.0.0.1:3000`. This is local forwarding, not LAN/public exposure.
- **Remote Android / web**: configure a trusted HTTPS reverse proxy to `127.0.0.1:3000`, set `NEXUS_PUBLIC_ORIGIN` to the exact public HTTPS origin, keep `NEXUS_OWNER_TOKEN` private, and log in using the device browser/WebView. TLS termination must be enforced at the edge. Do not publish the local Nexus port directly.
- **LAN without TLS**: intentionally unsupported for owner credentials. Use ADB reverse or a trusted TLS proxy; the older Android README's raw `http://192.168.x.x:3000` guidance is obsolete.
- **Device companions**: pair from an owner-authenticated UI. Native device WebSockets use a separate token. Re-pair devices if their platform changes; platform changes are no longer trusted from the connecting URL.

The repository's Caddyfile no longer permits a query parameter to select arbitrary proxy ports. `Caddyfile` on port 81 is *not* itself an HTTPS terminator; only place it behind a trusted TLS edge. The exact deployment topology must be reviewed before using public access.

## Owner permission and side-effect boundary

Session authentication answers **who** can request an action. It does not automatically approve **what** that action may do.

- `/api/browser` requires `browser_control`.
- `/api/mobile` requires `mobile_control`.
- `/api/terminal` execution requires `workspace_shell`, with additional `desktop_bridge` approval for explicit Windows target.
- `/api/computer-control` desktop command dispatch requires `desktop_bridge`; shell/Powershell also requires `workspace_shell`.
- A registered desktop command list is enforced. File move source *and* destination are checked against connected folders. Batch rename is temporarily disabled pending per-item validation.
- Pending UI approvals travel through authenticated `/api/control` and carry a SHA-256 action/target/payload fingerprint; the owner response must match that exact fingerprint. Replay/idempotency and actor-scoping review remain outstanding.

## Known blockers — do not call this a release

1. **P0: Trust, replay and audit.** Per-action SHA-256 action/target/payload approval binding and single-use policy for high-risk capabilities are implemented. Still independently verify expiry, replay/idempotency, actor scoping, one execution authority, audit integrity and fail-closed storage. Review remaining persistent `always` grants for low-risk scopes.
2. **P0: Companion filesystem.** Existing generated companion scripts perform lexical path checks. Verify *real filesystem* resolution, symlink/junction escapes and atomic write/race resistance before claiming remote file writes secure. Review remote command shell policy.
3. **P0: Network/device.** Independent security test of pairing-token replay, session hijack, expired/revoked tokens, WebSocket message quotas, spoofed command results, and platform escalation. Check WebView cookie behavior and direct TLS proxy deployment.
4. **P1: Runtime validation.** GitHub Actions run #130 passed `npm run test:security`, `npm run test:recovery`, `npm run typecheck`, `npm run lint` and `npm run build` on Ubuntu/Node 22. Native Electron media and Windows keyboard/microphone/screen tests, Android physical-device/WebView tests and independent review are still required.
5. **P1: Deploy setup.** Document and prove the full reverse proxy with TLS, forward headers, security headers, and service restarts. Do not trust client-provided forwarded headers for origin/auth decisions.

### No secret or database migration

This hardening branch changes code and example configuration only. It does **not** copy private `.env`, real login tokens, device pairing keys, SQLite data, user profile files or Nerve Core credentials.

## Handoff references

- Nexus audit: `docs/audits/NEXUS_VS_SAMJUNIORSOS_2026-11-21.md`
- Future Nerve Core plan: `docs/architecture/NERVE_CORE_FUTURE_INTEGRATION.md`
- Primary branch: `audit/samjuniorsos-selective-port-20261121` (draft PR #1).

## CI verification (2026-11-22)

The earlier run #34 had unavailable logs and is superseded. Current branch HEAD `d0aa4a078d2f3bb52d4e5fb89f3c25f51a9fa364` passed [GitHub Actions run #130](https://github.com/samjuniors/Nexus/actions/runs/44981448975), including dependency install, Prisma generation, security tests, recovery tests, typecheck, lint and production build. This does not replace native Windows/Android acceptance or independent security review.


## Windows acceptance update (2026-11-23)

- A Windows 11 acceptance clone reproduced a static junction escape in the artifact workspace: a junction below `agent-workspace` allowed read/write operations to reach an outside test fixture. The isolated PR branch now rejects existing symlink/junction components in `workspace.ts`, skips symlink entries during artifact/workspace listing, routes computer-use writes through the guarded save helper, and includes Windows junction regression tests. Self-Heal's path resolver also rejects existing symlink/junction components with a regression test.
- Windows local results: frozen Bun install, Prisma generation, security suite (including new junction tests), recovery suite (5/5), TypeScript, ESLint (0 errors; 4 warnings), production build, Electron CJS syntax checks, and local HTTP smoke (`/` and `/api/health` both 200) passed.
- Electron dependency is now `45.4.1` rather than `35.7.5`; `npm audit` for the Electron package reports 0 vulnerabilities. The Electron runtime binary download timed out, so actual Electron startup and native microphone/camera/screen prompts remain NOT RUN.
- `adb devices -l` found no attached Android device; Android/WebView acceptance remains NOT RUN.

### Remaining filesystem release blockers

1. The generated Companion Bridge's Connected Folders guard still uses lexical path containment. It must reject symlink/junction escapes using actual filesystem resolution before file reads, writes, listings and moves.
2. The current junction checks reject pre-existing links but do not prove race-free, handle-pinned TOCTOU safety. Do not claim atomic filesystem containment until tested against concurrent link replacement on Windows and POSIX.
3. Independent security review, replay/idempotency/actor-scope verification, Android physical-device acceptance, native Electron runtime permission acceptance and HTTPS reverse-proxy review remain required.

The Windows results are local acceptance evidence on the isolated clone, not a production approval. PR #1 remains draft and unmerged.
