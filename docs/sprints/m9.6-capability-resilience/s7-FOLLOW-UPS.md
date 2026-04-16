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

## FU2 — Hook-based blockedCommands counter

**Context:** DEV3 explains why the `blockedCommands` counter is not hook-wired.

**Suggested resolution:** Add a PostToolUse hook factory in
`packages/core/src/hooks/` that captures Bash blocks (when hook output says
`"blocked": true`) and wire it into the AutomationExecutor's `hooks` config for
test runs. This would give a proper count assertion.

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

## FU4 — FU1 from S6 is still open: update transcribe.sh to emit confidence + duration_ms

**Context:** S6-FOLLOW-UPS.md FU1 asks the CTO to update
`.my_agent/capabilities/stt-deepgram/scripts/transcribe.sh` to emit
`confidence` and `duration_ms`. The S7 test copies this script; if the script
doesn't emit those fields, `classifyEmptyStt` stays in conservative mode.

**Suggested resolution:** Update the script per S6-FU1's suggested jq patch.
This activates the "empty-result" CFR path (broken STT returning empty text
distinguished from silence). Out of framework scope — CTO-owned private file.
