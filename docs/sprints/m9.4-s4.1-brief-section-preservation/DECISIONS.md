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

## D8 — Wrapper-marker contract (post-merge fix)

**Context:** Post-merge live verification against today's real deliverable exposed a defect in the initial implementation. The `extractTopLevelHeadings` regex matched every `^## ` line, which caused two problems:
1. First pass: ANY `## Diagnosis` / `## Results` worker-internal heading was treated as a wrapper, so post-Haiku verification saw 59 "dropped" sections and fell back to raw on every real debrief.
2. Second pass (split-on-`---`): still over-detected because workers write `---` horizontal rules in their content, misaligning with the aggregator's `---` separator.

**Decision:** Introduce an explicit contract between aggregator and resolver. `handler-registry.ts::runDebriefReporter` prefixes each worker wrapper with `<!-- wrapper -->` (HTML comment, invisible in rendered markdown, workers cannot produce it). `summary-resolver.ts::extractWrapperHeadings` matches that exact marker via a regex built from the shared `WRAPPER_MARKER` constant. Both sides import the constant from summary-resolver — no string duplication.

**Consequences:**
- Silent-break guard: new unit test `wrapper-marker contract (silent-break guard)` asserts (a) the constant exists and is HTML-comment-shaped, (b) assembled aggregator output with `WRAPPER_MARKER` round-trips through extraction, (c) `handler-registry.ts` source imports `WRAPPER_MARKER` and does NOT hard-code the marker as a string literal. If a future editor diverges either side, the contract test fails loudly.
- Output-side check relaxed: `condensed.includes("## <name>")` → `condensed.includes(<name>)`. Wrapper heading names are stable identifiers (`chiang-mai-aqi-worker`, `cfr-fix-text-to-audio-a3-exec-<hash>`). A substring match on the name alone is robust to Haiku reformatting headings (different level, bold, emoji) while still catching true drops.

## D9 — Condense prompt hardened against wrapper-merging

**Context:** First live run produced Haiku output that correctly compressed content but merged `cfr-fix-test-type-a2` into `cfr-fix-test-type-a1` because the two retries had near-identical content. Per the never-drop invariant, raw fallback fired. Valid behavior, but defeated the condense path on any debrief with duplicative retry sections — which is every CFR-heavy debrief until M9.6-S20 lands.

**Decision:** Strengthen `CONDENSE_SYSTEM_PROMPT` with three additions:
1. Explicit instruction: "every wrapper heading MUST appear in the output in its original order — including near-duplicate headings such as retry attempts (`-a1`, `-a2`, `-a3` suffixes)".
2. Prescribed pattern for near-duplicate content: "keep BOTH headings and under the second write a single brief line like 'Same outcome as previous attempt.' — never merge two wrapper headings into one".
3. Output purity: "Return only the condensed markdown — no preamble, no explanation, no meta-commentary about the task" (Haiku had been adding a brief preamble paragraph).

**Consequence:** Second live run with strengthened prompt produced a 7,098-byte condense output from 34,271-byte fixture, all 14 wrappers present, AQI/Songkran/project-status markers preserved. Verdict: PASS.

## D10 — FU-7: extend delivery-observation to `initiate()`

**Context:** Post-merge external audit flagged that FU-7 was a twin of the alert() delivery-lying bug, just on the `no_conversation` fresh-install fallback path. Heartbeat called `markDelivered()` immediately after `initiate()` returned, regardless of whether initiate's model stream actually completed.

**Decision (in-scope expansion, CTO-approved):** Mirror the alert() outcome-observation pattern inside `initiate()`. `initiate()` now returns `InitiateResult = { conversation: Conversation; delivery: AlertResult }` — the created conversation plus an AlertResult-shaped delivery outcome with the same `delivered` / `skipped_busy` / `send_failed` / `transport_failed` semantics. All 6 callers updated: heartbeat fallback (FU-7 target), alert's channel-switch branch, automation-processor, automation-scheduler, app.ts's `AutomationNotifier` (also fixed a pre-existing dead-code `if (!alerted)` bug), and debug.ts (destructures `.conversation`).

**Consequences:**
- Channel-switch `alert()` now propagates initiate's delivery as the alert's result — no more blanket `{status: "delivered"}` after channel switch.
- Heartbeat retries on initiate failure via `incrementAttempts`, mirroring alert-path retry semantics.
- TypeScript exhaustiveness on the new InitiateResult shape surfaces any future caller that misses handling. Four inline structural aliases (heartbeat-service, automation-scheduler, automation-processor, server.ts) all extended to match the new signature.
- New test files: `conversation-initiator-initiate-outcome.test.ts` (4 tests — busy / error / happy / always-returns-conversation), plus 2 new heartbeat tests for the initiate-fallback skipped_busy and send_failed branches.

## D11 — FU-6: vestigial `briefingDelivered` field removed

**Context:** External reviewer flagged `SessionManager.briefingDelivered` as dead state — written in 3 places, never read. The actual delivery guard moved into the local `delivered` boolean inside `ackBriefingOnFirstOutput`.

**Decision:** Removed the field declaration and all three writes. Zero remaining references. No regression in tests.
