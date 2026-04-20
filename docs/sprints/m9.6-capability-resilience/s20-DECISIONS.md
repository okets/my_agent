---
sprint: M9.6-S20
---

# S20 Decisions

## D-0 — §2.5.0b FU-8 closed in S20; no behaviour change

`conversation-initiator.ts` external same-channel path: replaced `let response = ""` + `response += event.text` with `const chunks: string[] = []` + `chunks.push(event.text)`, and called `chunks.join("")` inline at the `forwardToChannel` call-site. `join("")` is only evaluated on the happy path, making the dead-state on `send_failed`/`skipped_busy` structurally invisible. Existing `conversation-initiator-alert-outcome.test.ts` (3 tests) all pass; no observable behaviour change. M9.4-S4.1 FOLLOW-UPS FU-8 annotated `✅ ADDRESSED IN M9.6-S20`.

## D-2 — §2.5.1 CFR-fix terse deliverable contract

`SKILL.md` Step 0 Fix Mode step 5 rewritten: `deliverable.md` body is now terse (2–5 lines, one-liner per attempt: `Attempt N: outcome — file`), and full diagnostic detail moves to a sibling `forensic.md`. Rationale: with S4.1's no-truncation aggregation, the old verbose deliverable (~2–3K per attempt) dominated the Haiku 10K condense budget. The terse format surfaces "voice fixed" to the user without the three-attempt forensic diary. Full detail is preserved in `forensic.md` for audit. Historical run dirs (S15–S19) use the old contract and are not edited. `capability-brainstorming-gate.test.ts` extended with two assertions (forensic.md named, terse contract present); new `fix-mode-deliverable-contract.test.ts` (6 tests) validates format rules and ESCALATE compatibility. Reference: M9.4-S4.1 incident 2026-04-20.

## D-3 — §2.5.2 Parallel-conversation originFactory not tested (named deferral)

The `parallel-conversation` origin factory (S12 obs #1) is not covered by the exit-gate tests. The shape requires two simultaneous CFR emits on different conversation IDs to exercise the de-dup / fan-out path. This is architecturally distinct from conversation-origin and automation-origin, and cannot be exercised by a single-shot E2E without additional test infrastructure. Decision: name the deferral explicitly in the automation-origin exit-gate test comment; add to M9.7 backlog. No observable gap for current production flows — parallel-conversation CFR paths share the same fix/reverify/reprocess pipeline as single-conversation.

## D-4 — §2.5.2 image-to-text plug type not covered (named non-coverage)

No `image-to-text` capability is installed in `.my_agent/capabilities/` on the test machine. The abbreviated replays test file would add a third describe block if the plug were present, following the same conversation-origin shape as the STT test. Decision: document the non-coverage explicitly. If a vision capability is added in a future milestone, a matching abbreviated replay should be added alongside it. No production gap — vision CFR flows through the same `CapabilityInvoker` path as STT.

## D-1 — §2.5.0 Test-suite triage: three root causes

**capabilities-singleton-visual.test.ts** — SHA-256 mismatch against baseline `a6285fe`. Root cause: the capabilities card CSS changed through three intentional commits after the baseline was written — Tailwind CDN removed and vendor assets self-hosted (`7e7f4c8`, `ac47f0a`), plus S19 Tailwind color-token corrections (`2b9f305`). No unintended regression. Baseline regenerated with `UPDATE_VISUAL_BASELINES=1`; new size 27 018 bytes.

**capability-ack-render.test.ts** — `data.handleWebSocketMessage is not a function`. Root cause: the function was renamed to `handleWsMessage` in `52ed05d` (M9.6-S8) without updating the test. Two additional issues surfaced during fix: (a) `Alpine.$data(body)` was selecting the body element rather than the `chat()` component root (`[x-data="chat()"]`); (b) `expect(locator).toBeVisible()` is a `@playwright/test` matcher — the test uses vitest's `expect`, so the assertion was replaced with `locator.waitFor({ state: "visible" })`; (c) the locator matched both desktop and mobile bubbles (strict-mode violation) — resolved with `.first()`. All behavioural changes are cosmetic: the `capability_ack` message does render in an `.assistant-bubble`; the original assertion shape was correct but mis-targeted.

**whatsapp-before-browser.test.ts** — `expected 0 to be greater than 0` on `failures.length`. Root cause: `transcribeAudio` was refactored in M9.6-S10 to route all STT calls through `CapabilityInvoker` (with CFR emitted inside the invoker). The test's fake app had no `capabilityInvoker` wired, so the code fell through to the legacy branch which returns `null` silently when no registry is configured — no CFR fired. Fix: added a `CapabilityInvoker` with a stub registry (`listByProvides: () => []`) to `makeTestApp`; the invoker emits `not-installed` CFR as it would in production when no STT capability is installed.
