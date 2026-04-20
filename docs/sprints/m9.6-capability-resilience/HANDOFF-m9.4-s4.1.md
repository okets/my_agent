# Handoff: M9.4-S4.1 Brief Section Preservation

**Date:** 2026-04-20  
**Merged:** `28db466` → master  
**Status:** S20 is now unblocked.

---

## What happened

Morning brief (2026-04-20) delivered an empty message. The news workers ran fine (8 stories). Root cause: `summary-resolver.ts` was slicing the aggregated debrief to 20,000 bytes before sending to Haiku. CFR-fix retry output from M9.6 (S1–S19) filled bytes 0–23,080; every user-facing section (news, AQI, events, expat tips, project status) lived past the cut.

---

## What changed in master

| File | Change |
|------|--------|
| `summary-resolver.ts` | Removed the 20K slice. Added `WRAPPER_MARKER`-based section extraction. Added 100K hard cap with fail-loud stub. Hardened `CONDENSE_SYSTEM_PROMPT` to preserve retry wrappers. |
| `handler-registry.ts` | Aggregator now prefixes each worker section with `<!-- wrapper -->\n` immediately before `## automationName`. |
| `conversation-initiator.ts` | `alert()` and `initiate()` now observe actual delivery outcome — never claims delivered when session was busy or errored. `initiate()` returns `{ conversation, delivery: AlertResult }`. |
| `session-manager.ts` | `markDelivered()` now fires after first `text_delta`, not before model invocation. |
| `heartbeat-service.ts`, `automation-processor.ts`, `automation-scheduler.ts`, `app.ts`, `debug.ts`, `server.ts` | Updated to handle `InitiateResult` shape. Dead-code `if (!alerted)` bug in `app.ts` fixed. |

All CFR machinery (S1–S19) is **untouched**.

---

## Three things you need to know

### 1. WRAPPER_MARKER — don't break this contract

`handler-registry.ts` prefixes every worker wrapper with `<!-- wrapper -->` immediately before the `## automationName` heading. `summary-resolver.ts` uses this marker (not generic `## ` detection) to identify aggregator-written sections. If you touch the debrief aggregation logic in `handler-registry.ts`, the marker prefix must survive.

The contract is verified by a unit test: `summary-resolver.test.ts` → `"wrapper-marker contract"` suite. A TypeScript import (`import { WRAPPER_MARKER } from "../automations/summary-resolver"`) in handler-registry is asserted at test time — if the marker is hard-coded or removed, the test fails.

### 2. FU-2 — CFR-fix deliverable format (highest-value pickup for S20 or adjacent)

The byte-slice is gone, but CFR-fix output is still verbose. On a day with failures, `deliverable.md` contains a three-attempt forensic diary that inflates the Haiku condense input. The fix:

- `deliverable.md` → one terse line per capability:  
  `"tts-edge-tts voice fixed (3 attempts, capability healthy). browser-chrome entrypoint restored (smoke green)."`
- Forensic detail (diagnosis, per-attempt state, decision log, validation commands) → sibling `attempts.md` or `forensic.md` in the same `run_dir`.
- `handler-registry.ts` reads `deliverable.md` first (lines 309–320); sibling files are ignored by the aggregator unless explicitly added.

After S4.1 + S20 + FU-2, a normal brief day should be ~6–8K chars.

### 3. S20 exit-gate criteria are unblocked

The two exit criteria can begin now:
- Working Nina screenshots via browser-control plug
- Conversation Nina understands voice via STT plug

No further merges are required from M9.4.

---

## Outstanding follow-ups (not S20 blockers)

| ID | Description | Owner |
|----|-------------|-------|
| FU-1 | Alert-layer conversation-context-budget gate (summarise before push, not before Haiku) | Future sprint |
| FU-2 | CFR-fix terse-deliverable contract | **S20 / adjacent — recommended** |
| FU-3 | `AlertResult` + `InitiateResult` type alias consolidation (5 inline structural copies) | Future tidy-up sprint |
| FU-4 | Document 8:13 AM brief delivery latency budget | Future sprint |
| FU-8 | Drop unused `response` accumulator on external same-channel error/busy branches | Cosmetic, future sprint |

Full detail: `docs/sprints/m9.4-s4.1-brief-section-preservation/FOLLOW-UPS.md`
