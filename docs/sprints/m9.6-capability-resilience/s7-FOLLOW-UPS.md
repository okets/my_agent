# S7 Follow-Ups — E2E Incident Replay + Exit Gate

Sprint: M9.6-S7
Branch: sprint/m9.6-s7-e2e-incident-replay

---

## FU1 — JSONL turn_corrected assertion requires a live brain session

**Context:** DEV2 explains why the `turn_corrected` event is not verified in
the exit gate test — `reprocessTurn` is stubbed to capture content only.

**Suggested resolution:** A dedicated integration test (separate from the exit
gate) could mock `sendSystemMessage` to write the `turn_corrected` event and
verify the JSONL shape. This belongs in a follow-up sprint focused on
conversation-layer correctness, not CFR resilience.

---

## FU2 ✅ RESOLVED — Structural proof replaces vacuous counter

**Resolved in:** M9.6-S7 cleanup (2026-04-16). The `blockedCommands` array and
its vacuous `expect(blockedCommands).toHaveLength(0)` assertion were removed.
Replaced with a comment explaining the structural proof: if the fix automation
issued `systemctl restart`, the safety hook at
`packages/core/src/hooks/safety.ts` would cause the job to fail, recovery would
not complete, and the "voice messages" assertion would fail. No surrender =
no blocked command = no manual intervention. The assertion is now clear and
non-misleading.

---

## FU3 — S7 test should run in CI with audio file provided via secrets

**Context:** The exit gate test is skipped in CI because the audio file is not
committed. For a proper gate (blocks M10 branch creation on failure), the audio
file should be available in CI.

**Suggested resolution:** Store `voice-1-incident.ogg` as a GitHub Actions
secret (base64-encoded) or in a private artifact store. The test's
`process.env.CFR_INCIDENT_AUDIO` override lets CI point to a temp file written
from the secret. One-sprint scope — add alongside CI config hardening.

---

## FU4 ✅ RESOLVED — transcribe.sh already emits confidence + duration_ms

**Resolved in:** M9.6-S7 cleanup (2026-04-16). See S6-FOLLOW-UPS.md FU1 for
details. The script already extracts and emits both fields from the Deepgram
response. `classifyEmptyStt` will correctly evaluate them. No action required.
