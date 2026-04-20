---
sprint: M9.4-S4.1
title: "Decisions — Brief Section Preservation"
date: 2026-04-20
runner: team-lead
---

# Decisions — M9.4-S4.1

## D1 — Principle: truncation may summarize, must not drop a section

**Context:** On 2026-04-20 the user's morning brief silently dropped all five user-facing worker sections (news, AQI, events, expat tips, project status). Root cause: `summary-resolver.ts:90` executed `text.slice(0, 20_000)` before passing content to Haiku. Sections past byte 20,000 were never seen by Haiku, never seen by the brain.

**Decision:** Elevate to an enforced invariant. Any size-reduction path in the brief pipeline may compress the body of a section, but must preserve every top-level worker-wrapper heading. Byte-slicing is banned. Heading preservation is asserted in tests (synthetic + live fixture).

**Consequence:** `summary-resolver.ts` now passes the full content to Haiku, the condense prompt mandates heading preservation, and a post-Haiku verification step falls back to raw content if any top-level heading is missing from Haiku output.

## D2 — Principle: delivery may fail, must not lie

**Context:** `alert()` in `conversation-initiator.ts` returned `{status: "delivered"}` even when `sendSystemMessage()` yielded no events (session busy) or yielded `{type: "error"}`. Heartbeat then marked queue items delivered that were never processed by the brain.

**Decision:** Any layer that reports delivery success must observe actual delivery. `alert()` now consumes `sendSystemMessage()` to completion, tracks `sawDone` and `errorMsg`, and returns:
- `delivered` only when a `done` event was observed and no error was yielded.
- `skipped_busy` when the generator yielded nothing (session-busy signal from `sendSystemMessage`).
- `send_failed` when an error event was yielded.

**Consequence:** False-positive delivered ACKs are eliminated. Heartbeat-level retry semantics are preserved — `skipped_busy` and `send_failed` both route to the same retry path as `transport_failed` (leave in queue, `incrementAttempts`, eventual give-up via `MAX_DELIVERY_ATTEMPTS`).

## D3 — Haiku input cap raised from 20 000 (silent slice) to 100 000 (fail-loud stub)

**Context:** The 20K slice was arbitrary and silent. Any payload larger than that was truncated without telemetry.

**Decision:** If the condense input exceeds 100 000 characters, do NOT call Haiku. Instead, return a stub of the form `[Debrief exceeded safe size (<N>K chars across <M> sections) — content preserved at <deliverable_path>. Section list: - <heading 1> ...]`, and `console.warn` with the total byte count and section count.

**Rationale:** 100K is well within Haiku's context window and the brief latency budget. Content exceeding 100K should never occur under normal operation and indicates a runaway worker that warrants operator attention rather than silent best-effort compression. The stub still lists every section heading so the brain can reference the on-disk deliverable.

## D4 — Three-layer defense for heading preservation (prompt → runtime check → fallback)

**Context:** Relying solely on a prompt instruction to preserve headings is insufficient — Haiku compliance is probabilistic.

**Decision:** Three layers, in order:
1. **Prompt-level:** `CONDENSE_SYSTEM_PROMPT` explicitly mandates that every top-level `## ` heading must appear in the output in its original order, while allowing body compression and internal subsection merging.
2. **Runtime check:** After Haiku returns, extract the set of top-level `## ` headings from the input and verify each appears in the output as substring `"## <name>"`. If any are missing, log a warning with the missing names.
3. **Fallback:** When the runtime check fails, return the raw input content unmodified rather than silently accept truncated Haiku output.

## D5 — New AlertResult statuses share retry semantics with `transport_failed`

**Context:** The `AlertResult` discriminated union gains `skipped_busy` and `send_failed`. Each caller of `alert()` must handle them.

**Decision:** `skipped_busy` and `send_failed` are treated the same way as the existing `transport_failed`: leave the notification in the heartbeat queue, increment attempts, rely on `MAX_DELIVERY_ATTEMPTS` (10) for eventual give-up. No new timer, no new retry cadence — just more accurate categorization of what went wrong.

**Consequence:** TypeScript exhaustiveness on `result.status` surfaces every caller that needs a new branch. A future new status (e.g. `delivery_aborted`) should produce compile errors the moment it's added.

## D6 — `markDelivered()` fires after first model output, not before model invocation

**Context:** `session-manager.ts:799-802` called `briefingResult.markDelivered()` before the model query began streaming. If the query failed between `markDelivered()` and first output, the briefing was marked delivered but the brain never processed it.

**Decision:** Move `markDelivered()` to fire on the first `text_delta` event observed in the stream consumer. Guard with a `briefingDelivered` boolean so error-after-first-token scenarios don't double-mark.

**Consequence:** If the session query throws before any output, the briefing stays in `pending/` and next session's briefing provider re-includes it. No data loss. The guard is load-bearing and is verified by a dedicated unit test (FU-5 tracks the test's independence from the production code).

## D7 — Alert-layer conversation-context-budget gate is explicitly out of scope

**Context:** During planning an orthogonal architectural concern was raised — the alert layer has no budget awareness and can overwhelm the brain's context window on busy days.

**Decision:** Explicitly out of scope for S4.1. Captured as FU-1 for a future sprint. S4.1's charter is delivery correctness (no drops, no lies), not backpressure.
