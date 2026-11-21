# Nexus → Google AI Studio Build handoff

**Date:** 2026-11-21  
**Intent:** Owner will use Google AI Studio after important SamjuniorsOS selective migrations are reviewed. This file is a handoff, **not** an authorization to deploy or rewrite the repositories.

## Current source of truth

- Private Nexus repository: https://github.com/samjuniors/Nexus
- Unmerged work: audit/samjuniorsos-selective-port-20261121, draft PR #1
- Canonical AI collaboration rules: AGENTS.md and CLAUDE.md
- Current migration report: docs/audits/NEXUS_VS_SAMJUNIORSOS_2026-11-21.md
- Security and release blockers: docs/security/OWNER_ACCESS_AND_RELEASE_GATES.md
- Nerve Core is deferred: docs/architecture/NERVE_CORE_FUTURE_INTEGRATION.md

**Important:** Nexus main does NOT yet contain the draft migration. Before an AI Studio import, confirm which commit or branch is being imported. Do not tell AI Studio the draft code is in main or overwrite main with a generated project.

## Google AI Studio capabilities and boundaries

Google's Build Mode documentation (https://ai.google.dev/gemini-api/docs/aistudio-build-mode) describes **Import from GitHub** under Add files (+), full-stack web app development, and Kotlin/Jetpack Compose Android app creation. Google's 2026-11-17 Android announcement (https://developers.googleblog.com/en/build-full-stack-android-apps-with-gemini-in-google-ai-studio/) describes emulator audio, physical-device installation, Firebase services and Android builds.

Nexus is not a blank generated app: it already uses Next.js, Prisma/SQLite, an Electron desktop shell, an Android Kotlin/WebView host, a portable brain, and device-bridge protocols. Treat unsupported or non-previewable pieces as source files to preserve, not automatically replace. AI Studio can help update Android and web code, but it does **not** establish acceptance for a Windows Electron installer or a live paired-device security system. Run Electron and PC acceptance separately.

## Safe import procedure for the owner

1. Confirm the Nexus PR's actual test and review status before importing, and retain a backup/copy of its exact HEAD.
2. In AI Studio Build mode select Add files (+) → Import from GitHub and authorize access to the private Nexus repository. Check the imported branch and commit. If your AI Studio workspace imports the default main branch only, do not silently substitute it for the draft; wait for a reviewed merge or import the exact reviewed source by a controlled source snapshot.
3. Tell the AI Studio agent to READ AGENTS.md, this handoff, the audit and security gates first. Request a **read-only architecture/integration inventory** before applying edits.
4. Preserve Next.js/Prisma schema, auth gateways, Android/Kotlin sources, Electron CJS, brain/ and existing tests. Do not scaffold a second app, replace the portable brain, create competing memories or reset user data.
5. Make one small, reviewable change at a time. Export changes as a branch/PR, compare file diffs and run existing tests. Do not blindly accept a one-click replacement of package.json, server.ts, schema.prisma or security modules.
6. Provision Google/Firebase services **only if explicitly chosen**; do not switch the source-of-truth database or credentials by default. Never put GEMINI_API_KEY, NEXUS_OWNER_TOKEN, pairing keys or OAuth secrets into client bundles, logs, prompts or Git.

## Paste into AI Studio after importing the reviewed Nexus source

You are continuing an existing private repository, Nexus, not creating a new prototype. First read AGENTS.md, CLAUDE.md, docs/HANDOFF_2026-11-21.md, docs/security/OWNER_ACCESS_AND_RELEASE_GATES.md, and this handoff. Inspect actual imported branch/commit. Keep Nexus/Eva UI, existing Next.js/Prisma architecture, Kotlin Android host, Electron desktop shell and portable brain/ with gbrain intact. SamjuniorsOS is a reference for selectively migrated security, voice reliability and desktop recovery; do not bulk-copy SamjuniorsOS. Nerve Core brain integration is postponed: do not touch, link or merge it.

Start read-only: inventory project structure, identify AI Studio preview/runtime limitations and run test:security, typecheck, lint, build if supported. Report exact failures without fabricating test results. Plan any changes by feature and submit small reviewed diffs to a separate branch. Never change passwords, keys, live pairings, real user databases, production deploy configuration or Git history. Preserve owner gateway, action-bound approvals and fail-closed security. Keep Electron Windows packaging and hardware tests as external acceptance gates.

## Current must-pass gates

- Typecheck and lint on the actual codebase.
- Node/TS security test suite, failure/denial paths, no broad standing grants for privileged actions.
- Desktop mic/camera/screen permission tests and app startup, browser UI, dictation checks.
- Android WebView authentication, HTTPS origin pairing, emulator/physical device audio, no permissions regression.
- SQLite schema preservation and backup/restore acceptance with a disposable database.
- Side-effect authorization and device bridge pairing/revocation, symlink traversal, audit failure, and prompt-injection tests.
- Real Windows installer packaging and Electron E2E (outside AI Studio if not supported).
- Independent security review, credentials kept private, explicit owner signoff for merge and release.

## Release warning

The existing draft CI run on the earlier branch revision failed without readable steps or logs; this is **not a code pass**. Future iterations must prove all gates with recorded commands/output. Do not mark Nexus finished or production ready solely because an AI Studio preview works.
