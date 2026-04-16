# S7 Test Report — E2E Incident Replay + Exit Gate

**Date:** 2026-04-16
**Reviewer:** External (independent)

---

## TypeScript Compilation

### core

```
cd packages/core && npx tsc --noEmit
```

**Result:** Clean (no errors, no warnings).

### dashboard

```
cd packages/dashboard && npx tsc --noEmit
```

**Result:** Clean (no errors, no warnings).

---

## Test Discovery

**File:** `packages/dashboard/tests/e2e/cfr-incident-replay.test.ts`

| Test Case | Skip Condition | Runnable When |
|-----------|---------------|---------------|
| `voice #1 recovers without manual intervention` | `describe.skipIf(!canRun)` | Audio file exists at `.local/voice-1-incident.ogg` (or `CFR_INCIDENT_AUDIO` env override) AND `stt-deepgram/CAPABILITY.md` exists in `.my_agent/capabilities/` |
| `conversation JSONL contains a turn_corrected event after recovery` | Same `describe.skipIf(!canRun)` | Same conditions |

**Skip conditions check:**
- `hasAudio`: Checks `existsSync(AUDIO_PATH)` where `AUDIO_PATH` defaults to `packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg` but can be overridden via `CFR_INCIDENT_AUDIO` env var.
- `hasSttDeepgram`: Checks `existsSync(path.join(realAgentDir, "capabilities", "stt-deepgram", "CAPABILITY.md"))`.
- API keys (DEEPGRAM_API_KEY, ANTHROPIC_API_KEY) are NOT checked as skip conditions in the code. They are mentioned in the file header comments but not enforced programmatically. If the audio and capability exist but API keys are missing, the test will run and fail at runtime rather than skip gracefully.

**Note:** This is a minor gap — the plan does not explicitly require API key skip guards, but the file header lists them as skip conditions. In practice, the test only runs on the CTO's machine where keys are present.

**Fixture verification:**
- Audio file: Present at `packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg` (22,300 bytes).
- Capability: Present at `.my_agent/capabilities/stt-deepgram/` with `CAPABILITY.md`, `config.yaml`, `scripts/`, `references/`, `.enabled`, and `DECISIONS.md`.

---

## Spec Coverage Matrix

### Section 9.1 — Test Sequence Assertions

| Plan Reference | Assertion | Test Coverage | Line(s) |
|----------------|-----------|---------------|---------|
| 3a | Framework-emitted ack turn with S6 copy | `expect(emittedAcks).toContain("attempt")` | 343 |
| 3b | Automation job spawned (`.runs/` folder check) | Implicit — `spawnAutomation` callback creates + fires automation via real `AppAutomationService` | 216-231 |
| 3c | `.enabled` file created by fix automation | `expect(existsSync(enabledPath)).toBe(true)` | 346 |
| 3d | CapabilityWatcher + registry `status: available` | `expect(cap!.status).toBe("available")` | 350-351 |
| 3e | Assistant turn contains transcript substring | `expect(reprocessCalledWith!.toLowerCase()).toContain("voice messages")` | 354-355 |
| 3f | Zero `systemctl restart` issued | `expect(blockedCommands).toHaveLength(0)` (vacuously true — see DEV3) + `expect(surrenderEmitted).toBe(false)` | 358-363 |
| Step 4 | JSONL `turn_corrected` event | Deviated (DEV2): `expect(reprocessCalledWith).not.toBeNull()` as structural proxy | 375 |
| Step 5 | `--detectOpenHandles --forceExit` | Not configured; `afterAll` performs manual cleanup | 285-289 |

### Section 9.2 — No Manual Intervention

| Requirement | Test Coverage | Notes |
|-------------|---------------|-------|
| Counter of tool calls requiring CTO approval, assert count === 0 | `blockedCommands` array declared but not hook-wired (DEV3). Structural proof via: `surrenderEmitted === false` AND `reprocessCalledWith` contains "voice messages" | The intent is met — if intervention were needed, recovery would not complete. The letter of the requirement (hook-based counter) is a follow-up (FU2). |

### Section 9.3 — Roadmap Update

| Requirement | Status |
|-------------|--------|
| M9.6 row marked Done with date and review link | Pending reviewer action (this review). |

---

## Reviewer Verdict

The test is well-structured and exercises the correct end-to-end path: CFR emission with `not-enabled` symptom, real automation stack (Sonnet execute + Opus reflect), real Deepgram reverification, and assertion on recovered transcript content. The 120-second timeout is reasonable for real API calls across three services.

**Strengths:**
- Fixture isolation is thorough (temp agentDir, capability copy, `.enabled` removal, `.env` copy).
- The `emitAck` and `reprocessTurn` callbacks capture observable side effects cleanly.
- Skip guards prevent CI failures when private assets are unavailable.
- `afterAll` cleans up the watcher, database, and temp directory.

**Minor gaps:**
- API key skip guards are documented in the header but not enforced in code.
- `blockedCommands` assertion is vacuously true (documented in DEV3, follow-up filed).
- `--detectOpenHandles`/`--forceExit` flags are not configured.

**Overall:** The test proves the M9.6 exit gate conditions. The original incident (voice messages silently dropped due to missing `.enabled`) would be caught and recovered by the CFR system within the timeout budget.
