# S7 Architect Review — E2E Incident Replay + Exit Gate

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s7-e2e-incident-replay`
**Review date:** 2026-04-16 (rejection) → 2026-04-16 (re-review after fix)
**Plan reviewed against:** [`plan.md`](plan.md) §9

---

## Verdict: **APPROVED — M9.6 exit gate passes**

Previous verdict (commit `713db58`): **REJECTED**. Two independent test runs on this machine failed 2/2 — first on missing Anthropic auth, then on `Claude Code process exited with code 1` after auth was loaded. No "Tests: N passed" line existed anywhere in S7 artifacts.

After the dev's fix commit (`e5f1bbd`): **APPROVED**. I re-ran the test independently via `npm run test:e2e` and got:

```
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    145.54s
```

Real end-to-end execution:
- CFR emitted with `symptom: "not-enabled"` at t=0
- Sonnet execute job ran attempt 1 → `completed`
- Opus reflect job ran → `completed`
- Reverify called `transcribe.sh` against the real incident audio
- Deepgram returned: *"hey nina how is songkran in chiang mai too like is there anything interesting to see today a big party maybe"*
- `reprocessTurn` called with the recovered content, no surrender emitted
- Zero manual intervention

This is the actual exit gate. M9.6 is done.

---

## What the dev fixed

Six root causes, all addressed:

1. **`agentDir` in `/tmp/` broke Claude Code subprocess** — the subprocess uses `settingSources: ["project"]` to find CLAUDE.md, which requires the agentDir to be inside the project tree. Moving it to `.my_agent/automations/` (alongside real automation runs) fixed the "Claude Code process exited with code 1" failure. More specific than my original hypothesis (I guessed `fakeApp` missing services).
2. **`canRun` missing auth guard** — added per my step 2.
3. **`test:e2e` missing `--env-file` + `-u CLAUDECODE`** — the `env -u CLAUDECODE` unset is a nice catch; the parent process's `CLAUDECODE` env var would have confused the subprocess.
4. **`TERMINAL_STATUSES` missing `"completed"`** — real bug I didn't diagnose. The executor writes `"completed"` but the orchestrator's polling set only had `"done"`, `"failed"`, etc. `awaitAutomation` would have spun until timeout even on a successful job. Nice catch.
5. **Transcript assertion text was wrong** — the plan text I wrote cited "voice messages now" (from the incident's JSONL narrative), but the actual audio file `f34ef464-...ogg` says the Songkran question. Dev corrected to `toContain("songkran")`. Plan error, not implementation error.
6. **120s timeout too tight** — real Sonnet + Opus + Deepgram cycle takes ~177s. DEV4 bumps to 300s. Reasonable.

---

## Plan ↔ code audit (final)

| Plan item | Location | Status |
|-----------|----------|--------|
| §9.1 E2E incident replay test file | `packages/dashboard/tests/e2e/cfr-incident-replay.test.ts` | Passes 2/2 in 142s |
| §9.1 3a ack turn with S6 copy | `emittedAcks.toContain("attempt")` | Verified — ack fires in run log |
| §9.1 3b automation job spawned | `spawnAutomation` callback fires real AutomationManager.create/fire | Verified — both Sonnet and Opus jobs ran to `completed` |
| §9.1 3c `.enabled` created by fix | `existsSync(enabledPath)` after recovery | Verified by passing assertion |
| §9.1 3d watcher + `status: available` | `registry.get("audio-to-text").status === "available"` | Verified by passing assertion |
| §9.1 3e transcript substring | `reprocessCalledWith.toLowerCase().toContain("songkran")` | Verified — real Deepgram output matches |
| §9.1 3f zero `systemctl restart` | `surrenderEmitted === false` + no surrender acks | Verified — structural proof holds because recovery actually succeeded |
| §9.1 turn_corrected JSONL | `reprocessCalledWith !== null` (DEV2-scoped) | Accepted deferral; real JSONL write happens in production reprocessTurn |
| §9.2 zero-manual-intervention | `surrenderEmitted === false` as structural proof | Verified — recovery completed without any surrender ack |
| §9.3 roadmap updated | `docs/ROADMAP.md` reverted to In Progress pending this re-review; ready to re-mark Done | Ready for the final roadmap commit |

Independent test run captured at `2026-04-16 08:14:30 UTC` on `sprint/m9.6-s7-e2e-incident-replay @ e5f1bbd`, full log available via `npm run test:e2e` in `packages/dashboard/`.

---

## What to do next

1. **Commit this review** to the sprint branch.
2. **Mark M9.6 Done in the roadmap** — with date `2026-04-16` and a link to this review. This is the legitimate roadmap-done commit, after architect approval, following the §0.3 rule 9 pattern.
3. **Merge the branch to master.**
4. **Start M10** in a fresh Sonnet session. M9.6 was the blocker — downstream work unblocks.

---

**Approved. M9.6 exit gate met.**
