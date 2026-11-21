# Future: Nerve Core ↔ Nexus Portable Brain

**Decision date:** 2026-11-21  
**Status:** DEFERRED BY OWNER — design-only placeholder, **no Nerve Core integration/merge authorized yet**.

**Repos remain independent:**
- Nexus (new host): https://github.com/samjuniors/Nexus
- Nerve Core (portable autonomous runtime): https://github.com/samjuniors/Nerve-Core
- SamjuniorsOS (existing OS reference): https://github.com/samjuniors/SamjuniorsOS

## Why avoid an immediate file merge?

Nexus currently contains a portable brain/ runtime with cognition, memory graph, coach, dreams, gbrain adapter, a BrainHost integration contract, and a stable Spine (brain-off) fallback. Nerve Core is a separate modular runtime with its own host/adapters, graph intelligence, and Nerve Connect protocol. Blindly merging folders would create conflicting schemas, multiple memory writers, conflicting permissions, inconsistent self-learning state, and hard-to-upgrade duplicated brains.

The user explicitly wants to combine Nerve Core with Nexus's portable brain **later**, not in this security milestone. Keep both source-of-truth repositories independent until that decision is revisited.

## Proposed architecture for later review

    Eva / Nexus UI (desktop, web, Android)
                      |
             One owner policy gateway
                      |
             One action authority
                      |
             Nexus BrainHost adapter
                  /        \
          Spine + Nexus   Nerve Connect
          brain runtime   (opt-in adapter)
                  \        /
              Shared versioned
              host-facing contract

- **Do not merge source trees initially.** Use a versioned, opt-in adapter between Nexus's host contract and Nerve Connect.
- **One active brain authority at a time.** Spine, Nexus portable brain, or Nerve Core. A second engine may run **read-only shadow evaluations** but cannot make mutations, issue tool commands, or rewrite memory.
- **One side-effect execution authority.** All computer use, browser actions, installations, payments, secrets and outbound communications go through Nexus's deterministic owner security gate, regardless of which brain reasons.
- **Provider neutrality.** Nerve Core may use replaceable LLMs and STT/TTS providers without redefining the host's secrets, identity, permission model or UX.
- **Memory arbitration.** Define canonical identity keys, provenance, graph-edge schema, consent, update timestamps, tombstones, memory decay/priorities and read/write ownership. No uncontrolled dual write between the Nexus gbrain store and Nerve Core graph memory.
- **Privacy and trust.** Nerve receives only scoped, consented contexts; deny by default. Enforce versioned adapter scopes, expiry, revocation, reconnection and offline recovery. Never pass raw provider credentials or private user DB contents to the other process.
- **UI stays Nexus.** Nerve Core is an intelligence runtime, not a replacement UI. Eva's design, Android/desktop surfaces and existing voice controls remain the host presentation layer.
- **Upgrades stay independent.** Nerve Core and Nexus can each update and roll back without requiring lockstep releases.

## Required evidence when owner authorizes this milestone

1. Inventory and pin exact current Nexus brain/ and Nerve Core/Nerve Connect commits. Compare data models, gbrain provenance and rights/licensing.
2. Decide the authoritative memory store; document reversible migration with backups, tombstones, integrity hashes, and de-duplication.
3. Version the adapter interface (connect, capability-discover, think, observe, memory-read, memory-write-request, action-propose, health, disconnect) with explicit scope and timeouts.
4. Prove no duplicate action execution, no two concurrent memory writers and no permission bypass during model/brain switching.
5. Run crash, kill, expired permission, revoked credential replay, offline resume and downgraded version tests.
6. Run side-by-side practical metrics: memory accuracy, task completion, startup latency, CPU/RAM, token cost, resilience and privacy.
7. Keep a kill switch and immediate fallback to Nexus Spine; require owner-approved cutover on a draft PR, **no direct main merge**.

## Current project boundary

The **2026-11-21 Nexus security and SamjuniorsOS selective-port work must not modify Nerve Core**. No new runtime dependency, Nerve Connect registration, Nerve Core DB import, or graph merge is in scope.

On future request to start the integration, revalidate current live GitHub and host states and prepare a reviewed plan first; do not assume this architecture is final.
