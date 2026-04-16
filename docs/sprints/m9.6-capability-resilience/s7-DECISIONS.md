# S7 Decisions — E2E Incident Replay + Exit Gate

Sprint: M9.6-S7
Branch: sprint/m9.6-s7-e2e-incident-replay

---

## D1 — Voice #1 is the larger OGG file

**Decision:** Voice #1 from the incident (conv-01KP3WPV3KGHWCRHD7VX8XVZFZ) is
`f34ef464-6c9e-4426-b315-2dfe0b6fc610.ogg` (22.3 KB). The smaller file
(2a7adba1, 6.4 KB) is voice #2 or #3.

**Why:** CTO confirmed (trip sprint Q1 answer: "larger file").

---

## D2 — Real Opus for the fix automation

**Decision:** The exit gate test uses the real automation stack with
`claude-sonnet-4-6` (execute phase) and `claude-opus-4-6` (reflect phase), not
fixture scripts. This is what the orchestrator spawns in production.

**Why:** CTO confirmed (trip sprint Q2 answer: "real opus"). The exit gate must
prove the full stack works.

---

## D3 — Fixture capability in temp agentDir (not real .my_agent/)

**Decision:** The test copies `stt-deepgram/` (without `.enabled`) from the
real `.my_agent/capabilities/stt-deepgram/` into a fresh temp agentDir. Both
the automation executor and the CapabilityWatcher point at this temp dir.

**Why:** Avoids modifying real `.my_agent/` files and avoids polluting real
conversations with test turns. The automation (Sonnet) runs with the temp dir
as its `agentDir`, so it looks for capabilities in `{tempDir}/capabilities/`
rather than the production dir. The copied scripts (including `transcribe.sh`)
still call Deepgram with the real API key from the copied `.env`.

**How the Sonnet fix works:** With `symptom: "not-enabled"`, Sonnet finds
`{tempDir}/capabilities/stt-deepgram/` via Glob, confirms `.enabled` is
absent, creates it, runs `transcribe.sh` against the fixture in
`packages/core/tests/fixtures/capabilities/`, writes `deliverable.md`.

---

## D4 — No `turn_corrected` JSONL assertion in the fixture test

**Decision:** The second test case asserts only that `reprocessCalledWith` is
non-null (the handoff happened). It does NOT assert a `turn_corrected` event in
the JSONL.

**Why:** In the exit gate test, `reprocessTurn` is a stub that captures the
recovered content. In production, it calls `app.chat.sendSystemMessage()` which
eventually writes the `turn_corrected` event. Stubbing a live brain session in
a test is out of scope for S7. The structural handoff (recovered content
contains "voice messages") is the authoritative assertion.

---

## D5 — Model IDs hardcoded, not from loadModels()

**Decision:** The test uses `claude-sonnet-4-6` and `claude-opus-4-6` as
literal strings rather than calling `loadModels(agentDir)`.

**Why:** The temp agentDir has no `config.yaml`, so `loadModels()` would fall
back to defaults anyway. Hardcoding the known current defaults is explicit and
avoids a config-file dependency in tests. These values match the production
defaults as of 2026-04-16.
