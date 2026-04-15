# Deviation Proposal — Sprint 4: awaitAutomation via Job-Status Polling

**self-answered: poll automationJobService.getJob() on 2s interval, 10min timeout**

**Blocker:** The `OrchestratorDeps.awaitAutomation` interface in plan §6.1 implies a blocking await for automation completion. No such API exists in the current automation infrastructure.

**Original plan says:**
> `awaitAutomation: (jobId: string, timeoutMs: number) => Promise<AutomationResult>`

> `AwaitAutomation` semantics require reading the job's `status-report.md` file only — which is fine, but is slow (polling). Confirm.
> — plan.md §6, escalation conditions

**What I found:**
- `AutomationJobService.getJob(id)` returns the current job record with `status` field (`automation-job-service.ts:95+`)
- Terminal statuses in the existing system: `"done"`, `"failed"`, `"needs_review"`, `"interrupted"`, `"cancelled"`
- No EventEmitter or promise-returning API for "wait until job finishes"
- `AutomationProcessor.runningJobs` is a private Map — not accessible from outside
- The `status-report.md` approach (reading from run_dir) is a valid fallback for deliverable content but still requires polling for terminal status

**Options I considered:**
1. **Poll `getJob()` every 2s up to 10min timeout** — uses existing public API; no infrastructure changes; straightforward. Unknown terminal statuses (future additions) treated as failure + logged at WARN per CTO instruction.
2. **Add a `once('job:done', handler)` EventEmitter to AutomationJobService** — cleaner, no busy-wait; but out of S4 scope (modifies shared infrastructure), requires S4 to also modify S1's contracts. File as follow-up instead.
3. **Read `status-report.md` from run_dir directly** — avoids DB; but run_dir may be undefined for some job types, and doesn't help with status detection (still needs polling).

**My recommendation:** Option 1, because it uses only existing public APIs, requires no infrastructure changes, and the 2s poll interval is negligible for fix automations that run 30s–5min. EventEmitter refactor filed as FOLLOW-UP.

**Blast radius:**
- `awaitAutomation` implementation is internal to `RecoveryOrchestrator` — no impact on other sprints.
- CTO additional rule: if `getJob()` returns a status not in the known terminal set, treat as failure and log `WARN: unknown terminal status ${status}` before returning failure. This prevents silent hangs if the automation system gains new statuses.

**Question for the architect:** None — self-answered. CTO confirmed 2s/10min is sane during trip-sprint pre-flight.
