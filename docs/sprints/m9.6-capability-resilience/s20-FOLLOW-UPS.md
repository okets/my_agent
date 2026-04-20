---
sprint: M9.6-S20
---

# S20 Follow-Ups

## FU-1 — Parallel-conversation originFactory coverage (M9.7 backlog)

The `parallel-conversation` CFR origin (S12 obs #1) was deferred in D-3. Add a test that emits two simultaneous CFR failures on different conversation IDs and asserts that both recovery chains complete independently without de-dup collision. Requires a concurrency harness — out of scope for S20.

## FU-2 — image-to-text abbreviated replay (when capability added)

When an `image-to-text` capability is installed in `.my_agent/capabilities/`, add a third `describe` block to `cfr-abbreviated-replays.test.ts` following the same conversation-origin shape as the STT test (with `rawMediaPath` pointing to a fixture image). The test infrastructure is already in place — only the describe block and fixture are needed.

## FU-3 — S15 phase-2 test files: migrate to shared helpers

The four S15 phase-2 tests (`cfr-phase2-browser-synthetic.test.ts`, `cfr-phase2-desktop-synthetic.test.ts`, `cfr-phase2-stt-replay.test.ts`, `cfr-phase2-tts-replay.test.ts`) still contain inline duplicated setup. They pass and are superseded by the S20 exit-gate tests for sign-off purposes. A future cleanup sprint could migrate them to use `cfr-exit-gate-helpers.ts`, but this is cosmetic and carries no functional risk.
