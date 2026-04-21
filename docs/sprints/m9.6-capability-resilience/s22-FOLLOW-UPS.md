---
sprint: M9.6-S22
title: Tool Capability Recovery Loop — Follow-Ups
date: 2026-04-21
---

# S22 Follow-Ups

## BUG-8 — Brain races CFR mid-session (ack ordering)

**Symptom:** When a tool capability fails mid-conversation, the brain has already started streaming a "I can't do that" reply before the CFR ack ("hold on, fixing it…") arrives. The user sees the stale error reply, then the fix ack — in the wrong order.

**Root cause:** The CFR pipeline fires asynchronously after `PostToolUseFailure`. The brain session has no hold gate to suppress output until the CFR resolves (unlike the STT input gate introduced in S13/S14 for conversation-origin input failures). There is no pre-delivery SDK hook to intercept the brain stream mid-flight.

**Why deferred to M10:** Fixing BUG-8 requires one of:
1. A pre-delivery brain-stream interception hook in the Agent SDK — not available in M9.6.
2. Mid-stream brain output suppression — architecturally invasive, race-prone without SDK support.

The Agent SDK hook surface is a planned M10 topic. BUG-8 should be revisited when the SDK exposes a pre-delivery hook or output hold mechanism.

**Impact while deferred:** Users may see a brief "I can't" reply followed by the fix ack and successful retry. Functionally correct but UX-jarring for tool capability failures triggered mid-session.

**Owner:** Defer to M10. No action required for M9.6 close.

---

## FOLLOW-UP-1 — Add `retryTurn` to remaining callers of `RecoveryOrchestrator`

**Context:** `retryTurn` is optional in `OrchestratorDeps` (D2). Any caller that doesn't wire it gets a `console.warn` and a silent no-op when a tool capability is fixed — the original request is not retried.

**Known callers to audit:** Any integration that instantiates `RecoveryOrchestrator` outside of `app.ts` (tests use stubs, but production integrations must wire it).

**Recommendation:** Before M10, audit all `new RecoveryOrchestrator({...})` call sites outside tests and confirm `retryTurn` is wired or explicitly opted out.

---

## FOLLOW-UP-2 — BUG-8 pre-condition: document brain-session hold gate surface

**Context:** The STT input gate (S13/S14) holds the conversation session open at the `WAITING_FOR_TRANSCRIPTION` state — the brain never starts because the turn hasn't resolved yet. A similar hold for mid-session tool failures would require either:
- A `WAITING_FOR_CAPABILITY` state inserted before the brain turn starts, or
- An SDK pre-delivery hook that can suppress a streamed response mid-flight.

**Recommendation:** Before M10 planning, document what SDK hook surface would be needed and file a request with the Agent SDK team if the capability doesn't exist.

---

## FOLLOW-UP-3 — Mode 3 (MCP-init) detection unverified for crash-at-startup failures (added 2026-04-21 after live-test-1)

**Context:** The first live retest engineered MCP-init failures (config corruption → server exits with code 2 at startup). For these, `PostToolUseFailure` doesn't fire — the failed MCP's tools never register, so the brain doesn't call them. The framework's intended detection path is **Mode 3** via `processSystemInit`: when the SDK emits `system_init_raw` with an MCP server marked failed, CFR fires proactively before any tool call.

**The dev's report says Mode 3 didn't fire during live-test-1.** Two candidate causes:
1. The SDK doesn't include the failed server in `mcp_servers[]` for the `system_init_raw` event when the stdio process exits immediately at boot, OR
2. The SDK's status string for a failed server doesn't match the expected `"failed"` value in `processSystemInit`.

**Why this matters:** Without Mode 3 working, "broken plug self-heals in background while user gets their result via fallback" doesn't happen. The user's task succeeds (Desktop MCP fallback) but `browser-chrome` stays broken indefinitely. CFR was supposed to detect this proactively. **For tool capabilities with parallel paths (every tool capability per D11), this is the only detection mechanism that catches startup failures.**

**Why deferred:** S22's scope is the (a)-shape (tool-call failure mid-session). Mode 3 is the (b)-shape (MCP-init failure at startup). Different code paths, different sprint. Adding Mode 3 verification + fix to S22 expands scope; cleaner to file as the next sprint's work.

**Status (2026-04-21):** Promoted to S23 (in scope) per CTO direction — *"any plug-side failure should be recoverable."* See `plan-phase3-refinements.md` §2.8.

**Recommended scope (now S23):** Specific tasks:
1. Add diagnostic logging at `processSystemInit` entry to capture the actual `mcp_servers[]` shape for both healthy and failed stdio servers.
2. Run a focused diagnostic: corrupt `browser-chrome/config.yaml` to make MCP exit at startup, start a session, capture `system_init_raw` payload.
3. If failed servers appear with a different status string, update the matcher in `processSystemInit`.
4. If failed servers don't appear at all, file an SDK gap and either: (a) wait for SDK fix, or (b) add a periodic health probe on registered MCP capabilities as a fallback detection mechanism.
5. Verify with a live retest: corrupt `browser-chrome` config, start session, confirm CFR fires from `processSystemInit` even though brain succeeds via Desktop MCP fallback.

**Owner:** S23 dev (planned 2026-04-21).
