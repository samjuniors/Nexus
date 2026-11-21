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
- Pending UI approvals travel through authenticated `/api/control`; approvals on that socket are **still pending payload-binding, replay, and actor-scoping hardening**.

## Known blockers — do not call this a release

1. **P0: Trust and action binding.** Apply cryptographically bound per-action permission receipts, one execution authority, audit integrity and fail-closed storage, following SamjuniorsOS governance concepts but adapting to Nexus Next.js. Current persistent `always` grants and best-effort audit are weaker.
2. **P0: Companion filesystem.** Existing generated companion scripts perform lexical path checks. Verify *real filesystem* resolution, symlink/junction escapes and atomic write/race resistance before claiming remote file writes secure. Review remote command shell policy.
3. **P0: Network/device.** Independent security test of pairing-token replay, session hijack, expired/revoked tokens, WebSocket message quotas, spoofed command results, and platform escalation. Check WebView cookie behavior and direct TLS proxy deployment.
4. **P1: Runtime validation.** Run `npm run test:security`, `npm run typecheck`, `npm run lint`, `npm run build`, Electron media and Windows keyboard/microphone/screen tests, Android functional tests, and independent review.
5. **P1: Deploy setup.** Document and prove the full reverse proxy with TLS, forward headers, security headers, and service restarts. Do not trust client-provided forwarded headers for origin/auth decisions.

### No secret or database migration

This hardening branch changes code and example configuration only. It does **not** copy private `.env`, real login tokens, device pairing keys, SQLite data, user profile files or Nerve Core credentials.

## Handoff references

- Nexus audit: `docs/audits/NEXUS_VS_SAMJUNIORSOS_2026-11-21.md`
- Future Nerve Core plan: `docs/architecture/NERVE_CORE_FUTURE_INTEGRATION.md`
- Primary branch: `audit/samjuniorsos-selective-port-20261121` (draft PR #1).

## CI incident (2026-11-21)

The draft-branch security workflow [run #34](https://github.com/samjuniors/Nexus/actions/runs/44906238469) completed with a **failure** conclusion, but GitHub's job API exposed no executed steps and log retrieval returned BlobNotFound. This is **not** a verified code-test failure or a verified runner/billing failure. Treat all CI acceptance gates as **NOT VERIFIED** until a readable job log and commands can be rerun.
