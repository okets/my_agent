# Post-fu3 Capability Worker Implications — Audit

**Date:** 2026-04-26
**Branch:** master @ f685f3e (fu3 merged at f41ea2e)
**Mode:** Read-only audit. No code modified.

---

## 1. TL;DR

A capability worker firing today would **succeed** end-to-end. The fu3 redesign deleted the executor's response-stream overwrite and the legacy `extractDeliverable`/`validateDeliverable` utilities — neither was being relied on by capability workers. The frontmatter-aware validators (`completion_report`, `test_executed`, `change_type_set`, `capability_frontmatter`) are still wired into the `todo` MCP server (`automation-executor.ts:457-462`) and still parse YAML correctly. The job-end gate `readAndValidateWorkerDeliverable` runs `deliverable_written`, which calls `readFrontmatter` and validates the *body* (not the frontmatter), so a capability worker that writes well-formed frontmatter + a 2–5 line body passes cleanly. `writePaperTrail` (executor.ts:1208) still parses `change_type`/`test_result` from the deliverable string. `recovery-orchestrator.readDeliverable()` (line 766) still reads frontmatter via `parseFrontmatterContent`. **Verdict: SAFE.** The redesign's "zero active capability workers, deferred migration" claim under-states scope (CFR fixes spawn dynamically) but the deferred migration itself was always cosmetic — Contract A still works.

---

## 2. Active capability workers in production

**Three** `job_type: capability_modify` manifests exist in `.my_agent/automations/`:

| File | status | notify | trigger |
|---|---|---|---|
| `fix-audio-to-text-capability.md` | `disabled` | immediate | manual |
| `fix-stt-hebrew-confidence-threshold.md` | `disabled` | immediate | manual |
| `fix-stt-hebrew-fallback-threshold.md` | `disabled` | immediate | manual |

**Zero are `status: active`.** Zero `capability_build` manifests exist outside `_archive/`. Plus 29 manifests in `.my_agent/automations/_archive/` (all `status: disabled`, all `capability_modify` for `cfr-fix-*`).

The redesign claim — "zero active capability-build/modify workers in production today" — is **literally correct for static manifests**, but materially incomplete: see §5.

---

## 3. Per-step trace — hypothetical `capability_build` firing today

Manifest `job_type: capability_build` → `assembleJobTodos()` (`todo-templates.ts:102`) returns 5 mandatory items, three with validators (`capability_frontmatter`, `test_executed`, `completion_report`).

1. **Worker SDK starts.** Executor passes `runValidation` into `createTodoServer` (`automation-executor.ts:457-462`). `target_path` resolved at line 451-453 — required for `capability_frontmatter` to find `CAPABILITY.md`. **Works.**
2. **Worker calls `todo_done(t2)` after writing CAPABILITY.md.** Todo MCP runs `runValidation("capability_frontmatter", runDir, targetDir)` → reads `CAPABILITY.md` from `targetDir`, checks `name`/`provides`/`interface`. **Works** (`todo-validators.ts:17-45`).
3. **Worker writes `deliverable.md` with frontmatter.** Per `capability-brainstorming/SKILL.md:39-44` and template todo text, must include `change_type`, `test_result`, `summary`. **No prompt-level conflict** — the cadence prompt at `automation-executor.ts:1157` says "Write deliverable.md first" but doesn't forbid frontmatter.
4. **Worker calls `todo_done(t4)` (test_executed).** Reads `data.test_result`. **Works.**
5. **Worker calls `todo_done(t5)` (completion_report).** Reads `data.change_type`, rejects `unknown`. **Works.**
6. **Run loop ends; executor calls `readAndValidateWorkerDeliverable(runDir)`** (`automation-executor.ts:660`). Inside, it calls `runValidation("deliverable_written", runDir)` (line 89). The `deliverable_written` validator parses frontmatter, takes the body, requires body ≥ 50 chars and rejects narration patterns. CFR-style 2–5 line body is ~100–500 chars — **passes**.
7. **Notification fires:** `summary-resolver.readAndStrip` strips frontmatter (`summary-resolver.ts:21-23`). **Works.** `handler-registry.ts:369` also calls `stripFrontmatter`. **Works.**
8. **Paper trail:** `writePaperTrail` (executor.ts:1208-1257) calls `parseFrontmatterContent` on the deliverable string and pulls `change_type`, `provider`, `test_result`, `test_duration_ms`, `files_changed` into a DECISIONS.md entry. **Works.**
9. **Recovery orchestrator (CFR path only):** `readDeliverable()` (`recovery-orchestrator.ts:766-780`) reads `change_type`/`test_result`/`summary`/`hypothesis_confirmed`/`surface_required_for_hotreload`. **Works.**

**Nothing silently fails. Nothing fails loud.**

---

## 4. Frontmatter readers beyond the four todo validators

| # | File:line | What it reads | Works post-fu3? |
|---|---|---|---|
| 1 | `automation-executor.ts:89` (`readAndValidateWorkerDeliverable` → `runValidation("deliverable_written")`) | body length + narration regex | **Yes** — `readFrontmatter` strips header before checking body |
| 2 | `automation-executor.ts:1216` (`writePaperTrail`) | `change_type`, `provider`, `test_result`, `test_duration_ms`, `files_changed` | **Yes** — `parseFrontmatterContent` on deliverable string |
| 3 | `core/.../recovery-orchestrator.ts:775` (`readDeliverable`) | `change_type`, `test_result`, `hypothesis_confirmed`, `summary`, `surface_required_for_hotreload` | **Yes** |
| 4 | `core/.../ack-delivery.ts:559` (`writeAutomationRecovery`) | *writes* CFR_RECOVERY.md frontmatter; consumes `failure` + `session.attempts` (NOT deliverable.md) | **Yes** — independent path |
| 5 | `scheduler/jobs/debrief-prep.ts:96` (`formatCfrRecoverySection`) | reads `CFR_RECOVERY.md` (not deliverable.md) — `plug_name`, `plug_type`, `outcome`, `attempts` | **Yes** |
| 6 | `scheduler/jobs/handler-registry.ts:369` (`runDebriefReporter`) | `stripFrontmatter` only — drops it, does not read fields | **Yes** |
| 7 | `automations/summary-resolver.ts:21` (`stripFrontmatter`) | regex strip only | **Yes** |
| 8 | `routes/automations.ts:197` (`/api/jobs/:id`) | reads raw bytes, returns as `fullDeliverable`; UI renders via `renderMarkdown(...)` (`public/index.html:8936`) | Cosmetic only — frontmatter renders as a `---` HR + bold key/value lines. Pre-existing behaviour, not introduced by fu3 |
| 9 | `automations/heartbeat-service.ts:25` | `deliverable.md` listed as a known artifact name; no parsing | **Yes** |

No hidden readers found. `grep -rn "readFrontmatter\|parseFrontmatterContent" packages/ --include="*.ts"` scanned to completion — every hit is accounted for.

---

## 5. CFR runtime spawn check

**The "all archived, dormant" claim is incomplete.** `recovery-orchestrator.ts:412-423` calls `deps.spawnAutomation(...)` with `jobType: "capability_modify"` whenever a registered capability fails. The production wiring at `app.ts:758-777` builds a fresh manifest in-memory:

```ts
app.automations.create({
  name: `cfr-fix-${capType}-a${n}-exec-${uuid}`,
  manifest: {
    model: opus,
    autonomy: "full",
    trigger: [{ type: "manual" }],
    once: true,
    job_type: spec.jobType,        // "capability_modify"
    target_path: spec.targetPath,  // capability folder
  },
});
await app.automations.fire(automation.id);
```

So `cfr-fix-*` automations **can** be created and fired without any pre-existing manifest, **today, in master**, the moment `app.cfr.on("failure", ...)` resolves a registered capability type. They will hit the post-fu3 worker pipeline. The fact that this still works correctly (per §3) is what makes the audit verdict SAFE rather than DEGRADED.

The 26 archived `cfr-fix-*` manifests are red herrings; the live spawn path is what matters.

---

## 6. Test coverage

Tests run (read-only, no service touched):

- `packages/dashboard/src/automations/__tests__/todo-validators.test.ts` — **17 passed**, exercises all four capability validators (`capability_frontmatter`, `completion_report`, `test_executed`, `change_type_set`) plus `deliverable_written` and `status_report`.
- `packages/dashboard/src/automations/__tests__/todo-templates.test.ts` — **12 passed**, includes capability_build and capability_modify template assembly.
- `packages/dashboard/tests/unit/automations/automation-executor.test.ts` — **13 passed**, includes `readAndValidateWorkerDeliverable` happy path + missing-file + body-too-short + narration cases.
- `packages/dashboard/tests/integration/cfr-mode3-init-detection.test.ts` — **5 passed**, exercises `spawnAutomation` → orchestrator wiring.
- `packages/dashboard/tests/integration/cfr-automation-mcp.test.ts` — **4 passed**.
- `packages/dashboard/tests/integration/cfr-tool-retry.test.ts` — **4 passed**.

`npx tsc --noEmit` clean for both `packages/core` and `packages/dashboard`.

**No capability-specific E2E test exercises the full spawn → write frontmatter deliverable → validator → paper-trail → CFR_RECOVERY.md chain in one go.** The closest is `cfr-phase2-stt-replay.test.ts` (e2e dir) which mocks `spawnAutomation`. The post-fu3 chain is tested in pieces but not end-to-end for capability_modify.

---

## 7. Latent footguns

1. **Cadence prompt vs. capability template ordering** — `automation-executor.ts:1157` says "Write deliverable.md FIRST", but `capability_build` template has the deliverable-emit step *last* (t5). A worker that takes the cadence prompt literally and writes deliverable.md before doing the actual work will write a placeholder, then either (a) overwrite it later (fine), or (b) forget. Today this is mitigated by capability-brainstorming/SKILL.md:39-47 which is explicit about Step 5 writing deliverable.md last in MODE: FIX. **Risk:** not all capability workers run via that skill — a `capability_build` invoked outside MODE:FIX has no per-step ordering guidance and could trip. *Footgun severity: low.*

2. **`deliverable_written` heuristic mismatched to capability bodies** — the narration check at `todo-validators.ts:128-149` has STRONG_OPENERS like `^Let me start by\b`. Capability fix bodies are formatted `Attempt 1: passed — file.sh` per the skill, which doesn't match — but a future worker writing `Let me document the change:` as the body would be rejected with a confusing "use Write tool to emit final report" error (when the worker did Write, just narrated). *Footgun severity: low.*

3. **No end-to-end test for capability_modify post-fu3** — see §6. The first time an `app.cfr.on("failure")` fires after fu3 in production *is* the integration test. *Footgun severity: medium.*

4. **`fullDeliverable` API exposes raw frontmatter to the dashboard UI** — `routes/automations.ts:197` returns raw bytes; `public/index.html:8936` renders via `renderMarkdown`. For capability deliverables the YAML header renders as a horizontal rule + bold key:value pairs in the expanded job card. Pre-existing, not fu3-induced. *Footgun severity: cosmetic.*

5. **Capability template validators don't include `deliverable_written`** — the four capability validators don't run the narration heuristic; only the job-end gate does. If a capability worker bypasses the job-end gate (e.g. via early return on abort path at `automation-executor.ts:643-646`), narration leaks through unguarded. The abort path returns `deliverable: null` so summary-resolver falls back — likely fine, but undocumented. *Footgun severity: low.*

---

## 8. Recommendations

| # | Footgun | Action |
|---|---|---|
| 1 | Cadence vs. capability template ordering | **Document as known constraint** — note in worker-pipeline-redesign.md that the "first" wording is for generic/research and capability workers follow per-skill ordering |
| 2 | `deliverable_written` heuristic | **Defer to S4.3** — when capability validators are migrated to a sidecar shape, simply omit the narration check for capability bodies |
| 3 | Missing end-to-end test for capability_modify | **Fix in S4.3** — add an e2e that spawns a real `cfr-fix-*` against a fixture capability and asserts the full chain (CFR_RECOVERY.md written, paper trail entry appended, debrief reads it) |
| 4 | `fullDeliverable` raw bytes in UI | **Document as known constraint** — pre-existing, low value to fix |
| 5 | No narration check on capability validators | **Defer to S4.3** — covered by sidecar migration |

**Nothing requires an urgent patch.** All items are either cosmetic, deferrable, or covered by existing skill instructions.

---

## 9. Verdict

**SAFE.** Post-fu3 master can spawn `cfr-fix-*` capability_modify automations on a live capability failure today; every frontmatter reader (validators, paper-trail writer, recovery-orchestrator) still works correctly; tests pass; type-check clean. The deferred S4.3 sidecar migration is a code-cleanliness improvement, not a correctness fix.
