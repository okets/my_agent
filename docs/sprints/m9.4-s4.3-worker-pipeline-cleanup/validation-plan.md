# M9.4-S4.3 — Post-merge validation plan

**Status:** Pending (waits for merge gate per [`plan.md`](plan.md) §Task 8)
**Executed by:** the merging agent (the same agent that authored this branch — me, future session)
**Estimated time:** 30 min on Day 0 + passive watch over 7 soak days

---

## When to start this

Begin Day-0 steps **immediately after** the merge to master completes and the dashboard service is restarted on master HEAD. Skip nothing — the smoke is cheap and the synth trigger is the closest live-fire we get without waiting for an organic capability failure.

---

## Day 0 — Smoke + synth trigger (30 min, all on production)

### Step 1 — Service restart + log tail (5 min)

- [ ] `systemctl --user restart nina-dashboard.service`
- [ ] `journalctl --user -u nina-dashboard.service -f` for 5 min during startup
- [ ] **Pass criteria:**
  - Service comes up cleanly (no stack traces in startup phase)
  - No `result.json malformed` warnings
  - No `result.json not found` warnings (acceptable for non-capability runs that legitimately don't write a sidecar)
  - No "Empty deliverable" warnings
- [ ] `curl -s http://localhost:4321/api/automations | jq 'length'` returns a number ≥ 1

### Step 2 — Chart self-service smoke (10 min, validates Item A)

- [ ] Open the dashboard, find `chiang-mai-aqi-worker` (or any active research worker that produces numeric data — list active research workers via the dashboard)
- [ ] Click "Fire now" / use `/api/automations/:id/fire`
- [ ] Wait for completion (status: `completed` in the job card)
- [ ] Inspect `${run_dir}/deliverable.md` directly:
  - [ ] **Pass:** contains `![chart](...)` inline AND it renders in the dashboard preview
  - [ ] **Acceptable:** no chart embed but readable narrative (charts were always opportunistic; absence is not regression)
  - [ ] **Fail:** broken `![chart](...)` URL that 404s, OR worker errored partway, OR executor logs mention "chart augmentation" (the code is gone — any reference is a stale import we missed)

### Step 3 — Capability synth trigger (15 min, validates Item B end-to-end)

This is the live-fire test for the new sidecar contract. Pick a disabled `fix-stt-*` manifest, fire once, revert.

- [ ] Choose: `.my_agent/automations/fix-audio-to-text-capability.md` (or one of the other two disabled `fix-stt-*.md`)
- [ ] Verify the target capability folder still exists at the manifest's `target_path` (CAPABILITY.md, DECISIONS.md present)
- [ ] Edit the manifest: `status: disabled` → `status: active`. Save.
- [ ] Wait for `nina-dashboard.service` to pick up the manifest change (chokidar watch; ~1 sec)
- [ ] Fire via `/api/automations/<id>/fire` (or dashboard button)
- [ ] **Wait for the job to reach a terminal state** (poll `/api/automations/<id>/jobs` or watch the dashboard card)
- [ ] Edit the manifest back: `status: active` → `status: disabled`. Save.
- [ ] **Pass criteria — verify on disk:**
  - [ ] `${run_dir}/deliverable.md` exists, plain markdown, **does NOT start with `---`** (no frontmatter)
  - [ ] `${run_dir}/result.json` exists, valid JSON
  - [ ] `result.json` contains `change_type` set to one of: `configure`, `upgrade`, `fix`, `replace` (NOT `unknown`)
  - [ ] `result.json` contains `test_result` ("pass" or "fail")
  - [ ] `${target_path}/DECISIONS.md` got a new entry with `Change type:`, `Test:` etc. populated from `result.json`
  - [ ] Job ended `completed` (not `needs_review` or `failed`)
- [ ] **If anything fails** — capture the run_dir contents, the job row from SQLite, and the relevant systemd log window. Do NOT roll back yet (a single sample isn't a regression signal); investigate the specific failure mode and decide.

### Step 4 — Day-0 summary

- [ ] Append a Day-0 row to the soak observation log (see Day 1-7 §3 below) with:
  - Service restart: ✅/❌
  - Chart smoke: ✅/⚠/❌ + brief note
  - Synth trigger: ✅/❌ + the run_dir path

---

## Day 1-7 — Passive soak (the real validation)

S4.3 inherits whatever soak days remain from S4.2's 7-day calendar window. The signals overlap with S4.2's morning soak gate, plus three S4.3-specific watch items.

### Daily watch (each morning, ~5 min)

- [ ] **Morning brief delivered cleanly?**
  - Open the conversation, scan the brief — picks what matters, structured, voice-rendered, no Read tool narration leakage, no truncation
  - Cross-check `notebook/operations/debrief-digest.md` for the day matches what Nina rendered
- [ ] **Daily relocation session delivered cleanly?**
  - Same scan
- [ ] **Empty deliverable frequency unchanged?**
  - `journalctl --user -u nina-dashboard.service --since "24 hours ago" | grep -c "Empty deliverable"` should be ≤ S4.2 soak baseline (which was 0 in clean days)
- [ ] **No `result.json` parse warnings?**
  - `journalctl --user -u nina-dashboard.service --since "24 hours ago" | grep "result.json"` — anything but the test fire is a signal
- [ ] **If any organic `cfr-fix-*` fired overnight, paper trail correct?**
  - Check `${target_path}/DECISIONS.md` for any new entry — it should have the typed fields populated from `result.json`, NOT the legacy frontmatter shape

### Soak observation log

- [ ] Maintain `docs/sprints/m9.4-s4.3-worker-pipeline-cleanup/soak-observations.md` with one section per day:
  ```
  ## Day N — YYYY-MM-DD

  - Brief: ✅
  - Relocation: ✅
  - Empty deliverable count: 0
  - result.json warnings: 0
  - Organic cap_modify fires: 0 (or N — list run_dirs)
  - Anomalies: none
  ```
- [ ] If a day regresses on ANY watch item: STOP, do not close the sprint, capture the relevant artifacts (run_dir + log window + DECISIONS.md diff if applicable), open a fix follow-up.

---

## Close gate (Day 7+)

S4.3 closes when ALL of the following are true:

- [ ] 7 calendar days post-merge with no watch item tripped
- [ ] At least one `cfr-fix-*` ran (synth-triggered Day 0 counts) with the new sidecar contract verified end-to-end
- [ ] Soak observation log filled out for each day
- [ ] No open follow-up tickets from the watch items

When all checked:

- [ ] Write `docs/sprints/m9.4-s4.3-worker-pipeline-cleanup/closeout-report.md` summarising:
  - Day-0 smoke + synth trigger results
  - 7-day soak observations
  - Any anomalies investigated and resolved
  - Final status: closed
- [ ] Update [`docs/ROADMAP.md`](../../ROADMAP.md): mark M9.4-S4.3 closed, mark M9.4 supplemental thread closed
- [ ] Move on to next milestone (M10 prep, etc.)

---

## What this plan does NOT validate

These gaps are accepted as out-of-scope for S4.3 validation. The audit ([`post-fu3-capability-implications.md`](../m9.4-s4.2-action-request-delivery/post-fu3-capability-implications.md)) and the e2e test in Task 5 cover them as much as they can be covered without real-world events:

- **Organic STT/TTS/etc. capability failures during soak.** Environmental, infrequent. Synth trigger above exercises the live recovery path once; if no organic fire happens during 7 soak days, that's normal. The audit verified pre-S4.3 master handles `cfr-fix-*` correctly; the structural change is small and the e2e test locks the contract.
- **Long-tail handler-driven automations** (`debrief-reporter`, etc.). Out of S4.3 scope; unchanged by this work — the audit explicitly recommended keeping them as-is.
- **Pre-existing browser test flake** (`tests/browser/capability-ack-render.test.ts`). Fails on master too, environmental — not introduced by S4.3.

---

## Rollback path

If a watch item trips and investigation shows the regression is S4.3-caused:

1. `git revert <merge-commit>` on master
2. Restart `nina-dashboard.service`
3. Verify the previously-tripping watch item recovers within one cycle (one brief, one relocation session)
4. Re-open S4.3 with the failure documented and a remediation plan

No schema migrations to unwind. No state files to reset. The sidecar `result.json` files written during the live window become orphaned on rollback but are inert (post-revert validators read frontmatter again, ignoring the sidecar).
