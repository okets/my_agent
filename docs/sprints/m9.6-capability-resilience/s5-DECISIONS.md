# S5 Decisions — Orphaned-Turn Watchdog

Sprint: M9.6-S5
Branch: sprint/m9.6-s5-orphaned-turn-watchdog

---

## D1 — Structural interfaces instead of cross-package imports

**Decision:** `packages/core/src/conversations/orphan-watchdog.ts` declares `RawMediaStoreLike`, `ConversationManagerLike`, `TranscriptLineLike`, etc. as structural interface types rather than importing the concrete types from `packages/dashboard`.

**Why:** `packages/core` must not depend on `packages/dashboard` (dashboard imports core, not the reverse — that would create a circular dependency). The dashboard's richer types are structurally assignable to the `*Like` interfaces, so no runtime behavior changes.

**Impact:** Test files in `packages/core` mock watchdog deps without any dashboard imports. Clean inversion.

---

## D2 — Marker event written BEFORE systemMessageInjector call

**Decision:** `watchdog_rescued` event is appended to the JSONL **before** `systemMessageInjector` is called, not after.

**Why:** Plan §7.1 explicitly calls this out to avoid a rescue loop on mid-rescue crash. If the process dies between event-append and inject, the next boot sees the `watchdog_rescued` marker and skips — at-most-once semantics. Appending after would mean a crash during inject leaves no marker, causing re-drive on every boot.

**Impact:** If inject fails after the event is written, the turn is still marked rescued (not re-driven), and the failure is logged at WARN. This is the correct tradeoff.

---

## D3 — Inline prompt fallback for dist/ runtime

**Decision:** `orphan-rescue.md` template is loaded from disk at runtime, but an inline fallback string literal exists in `orphan-watchdog.ts` for when the file isn't resolvable (e.g. running from `dist/` without the prompts directory copied).

**Why:** The prompts directory isn't in the TypeScript build output; `dist/` wouldn't have it unless explicitly copied. Rather than requiring a build step change, a deterministic fallback avoids silent breakage in production.

**Impact:** Template on disk (canonical, readable). Inline fallback (safe runtime). Functionally identical content.

---

## D4 — WatchdogRescuedEvent / WatchdogResolvedStaleEvent placed in types.ts, not transcript.ts

**Decision:** The two new event interfaces were added to `packages/dashboard/src/conversations/types.ts` (alongside all other event interfaces and the `TranscriptLine` union), not to `transcript.ts` as the plan literally specified.

**Why:** `transcript.ts` already imports from `types.ts`. Declaring new event types in `transcript.ts` while `types.ts` holds the union would require `types.ts` to import back from `transcript.ts`, creating a circular import. Moving declaration to `types.ts` follows the existing pattern for all other event types.

**Impact:** `transcript.ts` re-exports the two types so any code importing from `transcript.ts` still compiles without changes.

---

## D5 — OrphanWatchdog wired after ConversationInitiator block in app.ts

**Decision:** Watchdog instantiation was placed after `conversationInitiator` is constructed (line ~889) rather than immediately after `RecoveryOrchestrator` (line ~626) as the plan suggests.

**Why:** The plan says "after RecoveryOrchestrator" but `conversationManager` is instantiated at line 652 and `conversationInitiator` (needed for the injector's `forwardToChannel` call) at line 889. Placing before these would require forward references. The plan didn't anticipate the ordering of these dependencies in `app.ts`.

**Impact:** Watchdog boot sweep still fires during App construction, well before any request is served. Functionally equivalent to the plan's intent.

---

## D6 — reverify is optional in OrphanWatchdogConfig

**Decision:** The `reverify` field in `OrphanWatchdogConfig` is typed `optional`. It is only wired in `app.ts` when both `capabilityRegistry` and `capabilityWatcher` are non-null (i.e. a hatched agent with capabilities loaded).

**Why:** OrphanWatchdog must handle non-audio orphans (text turns, dashboard turns) even when capabilities are not loaded (unhatcher agents, test environments). Making reverify optional degrades gracefully: audio orphans get text-only rescue (placeholder content forwarded), non-audio orphans get normal rescue.

**Impact:** Audio-rescue test (#3) works because `reverify` is provided in the mock. Production audio rescue only fires for fully-hatched agents.
