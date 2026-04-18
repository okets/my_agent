# M9.1-S9: Heartbeat Liveness Fix — Sprint Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `job_interrupted` false positives caused by the heartbeat using `todos.json:last_activity` as the only liveness signal.

**Trigger incident:** 2026-04-18 — `thailand-news-worker` job `job-9d6ba79b` was flagged interrupted at 00:06:19 UTC (5m 17s after the last todo MCP call), then completed normally at 00:10:18 UTC. The user received a false alarm. Audit log shows the worker was actively making `WebFetch`, `mcp__browser-chrome__*`, and `Bash` tool calls right up to 00:04:50 UTC — only 1m 29s before the alarm fired. Investigation in conversation `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ`.

**Architecture:** Four layers, each independently shippable:

1. **Audit-log liveness signal** — extend `checkStaleJobs()` to also read the most recent audit-log entry for the job's `sdk_session_id`, treating that timestamp as activity. The audit log already captures every tool call (not just todo MCP) at `{agentDir}/logs/audit.jsonl`. **PRIMARY DEFENSE** — must work, because Layer 3 only catches narrow recovery windows.
2. **Run-dir mtime fallback** — when audit-log signal is absent or stale (e.g., during long subagent delegation), check the run-dir's recursive mtime. Subagent writes go through the worker process and touch files in the run dir, providing a tertiary signal.
3. **Recheck + minimum-age before deliver** — in `deliverPendingNotifications()`, (a) gate `job_interrupted` delivery to wait at least 60s after the notification was created, and (b) refetch the job before sending. If the job recovered (status no longer `interrupted`), drop the notification silently.
4. **Per-automation threshold override** — add optional `health.stale_threshold_ms` to `AutomationManifest`, plumb through executor → heartbeat. Lets long-running research workers opt into a higher threshold without bumping the global default.

We deliberately skip the "stream-event heartbeat from the executor" option (would touch the executor's `for await` loop). Layers 1+2+3 cover the observed failure mode; the executor change carries more risk and we'd only add it if these prove insufficient in practice.

**Why all three of 1+2+3 are needed (not just one):** Layer 1 alone misses the silent-thinking gap (the Apr 18 case had no audit activity from 00:04:50 → 00:07:53). Layer 2 catches that gap (run-dir gets touched as the worker streams content / writes screenshots / etc.). Layer 3 is a safety net for any corner case we haven't anticipated, AND it correctly handles the legitimate-stuck case where the worker truly died — no false negatives. Together they form defense-in-depth.

**Tech Stack:** TypeScript, vitest, no new dependencies.

**Files touched:** 5 source files, 2 test files. ~120 LOC net.

**Build order reminder (per CLAUDE.md):** Core types must be emitted before dashboard imports them. Whenever you change `packages/core/src/spaces/automation-types.ts`, run `cd packages/core && npx tsc` (without `--noEmit`) before any dashboard test or build step.

---

## File Structure

**Create:**
- `packages/dashboard/src/automations/audit-liveness.ts` — pure helper that tails `audit.jsonl` and returns the most recent timestamp for a given `sessionId`. Bounded read (last N lines) to keep cost flat as the log grows.

**Modify:**
- `packages/dashboard/src/automations/heartbeat-service.ts` — extend `HeartbeatConfig` with `agentDir`, use audit-liveness in `checkStaleJobs()`, add recheck-before-deliver in `deliverPendingNotifications()`, accept per-job threshold override.
- `packages/dashboard/src/app.ts:1912-1922` — pass `agentDir` to the heartbeat config.
- `packages/core/src/spaces/automation-types.ts:26-49` — add optional `health` field to `AutomationManifest` and `CreateAutomationInput`.
- `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts` — add tests for new behavior.

**Test:**
- `packages/dashboard/src/automations/__tests__/audit-liveness.test.ts` — unit tests for the new helper.

---

### Task 1: Add `health.stale_threshold_ms` to manifest types AND serializer

**Files:**
- Modify: `packages/core/src/spaces/automation-types.ts:26-49` and `:83-99`
- Modify: `packages/dashboard/src/automations/automation-manager.ts:284-330` (both `manifestToFrontmatter` and `frontmatterToManifest`)

> **Why the serializer matters:** `automation-manager.ts` explicitly maps a closed list of fields to/from frontmatter. Unknown fields are dropped on read AND not written on save. Without updating it, `health: {...}` in the YAML will be silently discarded, and Task 11's overrides will have no effect.

- [ ] **Step 1: Add `health` field to types**

Open `packages/core/src/spaces/automation-types.ts`. Insert after the `job_type?:` line in `AutomationManifest` (around line 48):

```ts
  /** Optional health/liveness overrides for the heartbeat service.
   *  When omitted, defaults from heartbeat config apply. */
  health?: {
    /** Override the stale-job threshold for this automation (milliseconds).
     *  Use for legitimately long-running workers (research, multi-site fetch). */
    stale_threshold_ms?: number
  }
```

Add the same field to `CreateAutomationInput` after its `job_type?:` line.

- [ ] **Step 2: Wire the field through the manifest serializer**

In `packages/dashboard/src/automations/automation-manager.ts`, find `manifestToFrontmatter` (around line 284). Add before the `return fm;` line:

```ts
    if (manifest.health) fm.health = manifest.health;
```

Then find `frontmatterToManifest` (around line 311). Add this line inside the returned object (before the closing brace, alongside the other field mappings):

```ts
      health: data.health as AutomationManifest["health"],
```

- [ ] **Step 3: Build core (EMIT — not just typecheck) so dashboard imports see the new field**

Run: `cd packages/core && npx tsc`
Expected: PASS (no errors). This emits to `packages/core/dist/`. **Do not skip emit** — the dashboard package imports from compiled JS at runtime even though types resolve from source. CLAUDE.md mandates this build order.

- [ ] **Step 4: Build dashboard to verify the serializer typechecks**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Round-trip test for the manifest serializer**

Add to `packages/dashboard/src/automations/__tests__/` a quick test (or extend an existing automation-manager test if one exists) that:

```ts
it("preserves health field through frontmatter round-trip", () => {
  const original: AutomationManifest = {
    name: "test",
    status: "active",
    trigger: [{ type: "manual" }],
    created: "2026-04-18T00:00:00.000Z",
    health: { stale_threshold_ms: 900000 },
  };
  // Use the manager's private methods if they're exposed for testing,
  // OR write to a temp file and read back via the public load path.
  // Assert: loaded.manifest.health?.stale_threshold_ms === 900000
});
```

If `manifestToFrontmatter` and `frontmatterToManifest` are private, expose them via a test export OR write a file-roundtrip integration test using `automationManager.create()` followed by re-load.

Run: `cd packages/dashboard && npx vitest run automation-manager`
Expected: PASS (round-trip preserves `health.stale_threshold_ms`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/spaces/automation-types.ts \
        packages/dashboard/src/automations/automation-manager.ts \
        packages/dashboard/src/automations/__tests__/
git commit -m "feat(m9.1-s9): add health.stale_threshold_ms manifest field + serializer"
```

(If `packages/core/dist` is tracked rather than gitignored, also `git add packages/core/dist`.)

---

### Task 2: Write failing test for audit-liveness helper

**Files:**
- Test: `packages/dashboard/src/automations/__tests__/audit-liveness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/automations/__tests__/audit-liveness.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readLastAuditTimestamp } from "../audit-liveness.js";

describe("readLastAuditTimestamp", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-liveness-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when audit log does not exist", () => {
    const result = readLastAuditTimestamp(tmpDir, "session-x");
    expect(result).toBe(0);
  });

  it("returns 0 when no entries match the session", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    fs.writeFileSync(
      path.join(tmpDir, "logs", "audit.jsonl"),
      JSON.stringify({ timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "other-session" }) + "\n",
    );
    const result = readLastAuditTimestamp(tmpDir, "target-session");
    expect(result).toBe(0);
  });

  it("returns the most recent timestamp for a matching session", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    const lines = [
      { timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "target" },
      { timestamp: "2026-04-18T00:01:00.000Z", tool: "Bash", session: "other" },
      { timestamp: "2026-04-18T00:02:00.000Z", tool: "WebFetch", session: "target" },
      { timestamp: "2026-04-18T00:03:00.000Z", tool: "Edit", session: "other" },
    ].map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(path.join(tmpDir, "logs", "audit.jsonl"), lines + "\n");

    const result = readLastAuditTimestamp(tmpDir, "target");
    expect(result).toBe(new Date("2026-04-18T00:02:00.000Z").getTime());
  });

  it("only scans the tail of large audit logs (bounded cost)", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    // Write 5000 lines: 4990 unrelated, last 10 for our session
    const lines: string[] = [];
    for (let i = 0; i < 4990; i++) {
      lines.push(JSON.stringify({ timestamp: `2026-04-18T00:00:${String(i % 60).padStart(2, "0")}.000Z`, tool: "Read", session: "noise" }));
    }
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ timestamp: `2026-04-18T01:00:${String(i).padStart(2, "0")}.000Z`, tool: "Bash", session: "target" }));
    }
    fs.writeFileSync(path.join(tmpDir, "logs", "audit.jsonl"), lines.join("\n") + "\n");

    const result = readLastAuditTimestamp(tmpDir, "target");
    expect(result).toBe(new Date("2026-04-18T01:00:09.000Z").getTime());
  });

  it("returns 0 if the matching session entries are older than the tail window", () => {
    // Edge case: 64KB tail with VERY heavy concurrent traffic could push
    // a session's recent entries off the back. We accept this — heartbeat
    // falls back to todos.json + run-dir signals.
    fs.mkdirSync(path.join(tmpDir, "logs"));
    const lines: string[] = [];
    // First entry: target session (will be off the back)
    lines.push(JSON.stringify({ timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "target" }));
    // Then 1000 noise entries that easily exceed 64KB
    for (let i = 0; i < 1000; i++) {
      lines.push(JSON.stringify({ timestamp: "2026-04-18T01:00:00.000Z", tool: "Read", session: "noise", padding: "x".repeat(100) }));
    }
    fs.writeFileSync(path.join(tmpDir, "logs", "audit.jsonl"), lines.join("\n") + "\n");

    const result = readLastAuditTimestamp(tmpDir, "target");
    expect(result).toBe(0);  // OK — fallback signals will catch it
  });

  it("returns 0 when sessionId is empty/undefined (handle missing sdk_session_id gracefully)", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    fs.writeFileSync(
      path.join(tmpDir, "logs", "audit.jsonl"),
      JSON.stringify({ timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "x" }) + "\n",
    );
    expect(readLastAuditTimestamp(tmpDir, "")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/audit-liveness.test.ts`
Expected: FAIL with "Cannot find module '../audit-liveness.js'"

---

### Task 3: Implement audit-liveness helper

**Files:**
- Create: `packages/dashboard/src/automations/audit-liveness.ts`

- [ ] **Step 1: Write the helper**

Create `packages/dashboard/src/automations/audit-liveness.ts`:

```ts
/**
 * Audit-log liveness reader (M9.1-S9).
 *
 * Tails the per-agent audit.jsonl to find the most recent tool-call timestamp
 * for a given SDK session. Used by the heartbeat to corroborate todo-file
 * activity — any tool call (WebFetch, Bash, Edit, browser MCP, etc.) counts
 * as evidence the worker is alive, even if it isn't touching todos.
 */

import fs from "node:fs";
import path from "node:path";

/** Tail size — bounds read cost. Audit log grows ~110 bytes per tool call.
 * With multiple concurrent sessions (brain + workers + subagents) writing
 * to the same file, an 8KB tail (~75 lines) can cover only seconds of
 * wall-clock. 64KB (~600 lines) is the sweet spot — still <1ms to read, and
 * comfortably covers a 15-min window even under heavy concurrent traffic.
 *
 * If this proves insufficient in practice (e.g., very busy multi-worker
 * setups), upgrade to chunked backward reads. For now, fixed-size tail. */
const TAIL_BYTES = 64 * 1024;

/**
 * Read the most recent audit-log timestamp for the given session ID.
 *
 * @param agentDir Absolute path to the agent dir (contains logs/audit.jsonl)
 * @param sessionId The job's sdk_session_id
 * @returns Most recent timestamp as ms-since-epoch, or 0 if none found
 */
export function readLastAuditTimestamp(agentDir: string, sessionId: string): number {
  if (!sessionId) return 0;
  const logPath = path.join(agentDir, "logs", "audit.jsonl");

  let stat: fs.Stats;
  try {
    stat = fs.statSync(logPath);
  } catch {
    return 0;
  }

  const fd = fs.openSync(logPath, "r");
  try {
    const readBytes = Math.min(TAIL_BYTES, stat.size);
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    const text = buf.toString("utf-8");

    // Drop the first (likely partial) line if we did a mid-file read
    const lines = stat.size > readBytes ? text.split("\n").slice(1) : text.split("\n");

    let latest = 0;
    for (const line of lines) {
      if (!line) continue;
      let entry: { timestamp?: string; session?: string };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.session !== sessionId) continue;
      if (!entry.timestamp) continue;
      const t = new Date(entry.timestamp).getTime();
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    return latest;
  } finally {
    fs.closeSync(fd);
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/audit-liveness.test.ts`
Expected: PASS (4/4)

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/automations/audit-liveness.ts \
        packages/dashboard/src/automations/__tests__/audit-liveness.test.ts
git commit -m "feat(m9.1-s9): add audit-log liveness reader"
```

---

### Task 4: Add `agentDir` (optional) to `HeartbeatConfig` and import helper

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts`

> **Why this comes before the test:** adding the test in Task 5 will reference `agentDir` in `createHeartbeat()`. If `HeartbeatConfig` doesn't have the field yet, that's a TypeScript error that blocks ALL tests in the suite — not just a failing test. Make the field exist (optional, no behavior yet) FIRST, write the failing test SECOND, implement behavior THIRD. This preserves the red→green TDD signal.

- [ ] **Step 1: Add `agentDir` as optional to `HeartbeatConfig`**

At the top of `heartbeat-service.ts`, add the import:

```ts
import { readLastAuditTimestamp } from "./audit-liveness.js";
```

In the `HeartbeatConfig` interface (line 14), add — **optional** so existing tests/callers don't need updating:

```ts
  /** Agent directory — used to read logs/audit.jsonl for per-session liveness.
   *  When undefined, the audit-log signal is skipped and only todos.json activity is used. */
  agentDir?: string;
```

- [ ] **Step 2: Build dashboard to verify no regressions**

Run: `cd packages/dashboard && npx tsc --noEmit && npx vitest run src/automations/__tests__/heartbeat-service.test.ts`
Expected: PASS — all existing tests still pass, no behavior change.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts
git commit -m "chore(m9.1-s9): add optional agentDir to HeartbeatConfig"
```

---

### Task 5: Failing test — heartbeat respects audit-log activity

**Files:**
- Modify: `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts`

- [ ] **Step 1: Add helper for audit log fixture in the test file**

At the top of the test file, after the existing imports, add:

```ts
function writeAuditLog(agentDir: string, entries: Array<{ timestamp: string; session: string; tool?: string }>) {
  const logsDir = path.join(agentDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify({ tool: e.tool ?? "Bash", ...e }));
  fs.writeFileSync(path.join(logsDir, "audit.jsonl"), lines.join("\n") + "\n");
}
```

- [ ] **Step 2: Update `createHeartbeat` to pass `agentDir`**

Find the `createHeartbeat` helper around line 51 and add `agentDir: tmpDir` to the config object. (Field exists from Task 4 so this typechecks cleanly.)

```ts
function createHeartbeat(overrides = {}) {
  return new HeartbeatService({
    jobService: mockJobService as any,
    notificationQueue: queue,
    conversationInitiator: mockCi as any,
    agentDir: tmpDir,                    // NEW
    staleThresholdMs: 5 * 60 * 1000,
    tickIntervalMs: 999999,
    capabilityHealthIntervalMs: 999999,
    ...overrides,
  });
}
```

- [ ] **Step 3: Add the failing test case**

Add this test to the `describe("HeartbeatService", ...)` block:

```ts
it("does NOT mark interrupted when audit log shows recent tool activity", async () => {
  const runDir = path.join(tmpDir, "run-busy");
  fs.mkdirSync(runDir, { recursive: true });

  // Stale todos — last touch 6 min ago
  writeTodoFile(path.join(runDir, "todos.json"), {
    items: [
      { id: "t1", text: "Research", status: "in_progress", mandatory: false, created_by: "agent" },
    ],
    last_activity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  });

  // Audit log shows tool activity 90s ago — worker is alive
  writeAuditLog(tmpDir, [
    { timestamp: new Date(Date.now() - 90 * 1000).toISOString(), session: "sess-busy", tool: "WebFetch" },
  ]);

  mockJobService.listJobs.mockReturnValue([
    makeJob({ id: "job-busy", run_dir: runDir, sdk_session_id: "sess-busy" }),
  ]);

  const hb = createHeartbeat();
  await hb.tick();

  expect(mockJobService.updateJob).not.toHaveBeenCalledWith(
    "job-busy",
    expect.objectContaining({ status: "interrupted" }),
  );
  expect(queue.listPending()).toHaveLength(0);
});
```

- [ ] **Step 4: Add a test that confirms `neverStarted` is unaffected (R7 hardening)**

```ts
it("still triggers neverStarted even when audit log shows activity (intentional)", async () => {
  // Documenting the limitation: a job with empty todos AND audit activity
  // still trips the 2-min neverStarted heuristic. Out-of-scope for S9 to fix.
  const runDir = path.join(tmpDir, "run-no-todos");
  fs.mkdirSync(runDir, { recursive: true });
  writeTodoFile(path.join(runDir, "todos.json"), {
    items: [],
    last_activity: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  });
  writeAuditLog(tmpDir, [
    { timestamp: new Date(Date.now() - 30 * 1000).toISOString(), session: "sess-x", tool: "WebFetch" },
  ]);
  mockJobService.listJobs.mockReturnValue([
    makeJob({
      id: "job-no-todos",
      run_dir: runDir,
      sdk_session_id: "sess-x",
      created: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    }),
  ]);

  const hb = createHeartbeat();
  await hb.tick();

  expect(mockJobService.updateJob).toHaveBeenCalledWith(
    "job-no-todos",
    expect.objectContaining({ status: "interrupted" }),
  );
});
```

- [ ] **Step 5: Run tests to verify the audit-log one fails (red), neverStarted one passes (already green by current behavior)**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts -t "audit log shows recent"`
Expected: FAIL — `updateJob` was called with `status: "interrupted"` (current bug).

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts -t "neverStarted"`
Expected: PASS already.

---

### Task 6: Wire audit-log liveness into `checkStaleJobs`

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts`
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Add `fs` import**

The current `heartbeat-service.ts` imports only `path` from node. Add at the top:

```ts
import fs from "node:fs";
```

- [ ] **Step 2: Use audit-log timestamp in `checkStaleJobs` — with LAZY Layer 2**

Replace lines 104-108 in `checkStaleJobs`:

```ts
      const todoPath = path.join(job.run_dir, "todos.json");
      const todoFile = readTodoFile(todoPath);

      const todoTime = new Date(todoFile.last_activity).getTime();
      const auditTime =
        this.config.agentDir && job.sdk_session_id
          ? readLastAuditTimestamp(this.config.agentDir, job.sdk_session_id)
          : 0;
      let lastActivity = Math.max(todoTime, auditTime);

      // Layer 2 (R9 hardening, made LAZY): only walk the run-dir if BOTH
      // todo and audit signals are stale. Catches subagent-delegation gaps
      // where worker session is silent in the audit log but files are
      // still being written. Skipped on the hot path when audit is fresh.
      if (now - lastActivity > this.config.staleThresholdMs) {
        const runDirTime = readRunDirMtime(job.run_dir);
        lastActivity = Math.max(lastActivity, runDirTime);
      }

      const isStale = now - lastActivity > this.config.staleThresholdMs;
```

- [ ] **Step 3: Add the `readRunDirMtime` helper at the top of the file**

```ts
/** Recursive mtime of the run dir — fallback liveness signal that catches
 * file writes from subagents and the executor itself. Best-effort; returns
 * 0 on any error. Bounded: skips entries beyond depth 4 to avoid pathological
 * traversal of capability scratch dirs. */
function readRunDirMtime(runDir: string | undefined, maxDepth = 4): number {
  if (!runDir) return 0;
  try {
    let latest = 0;
    const stack: Array<{ dir: string; depth: number }> = [{ dir: runDir, depth: 0 }];
    while (stack.length > 0) {
      const { dir, depth } = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs > latest) latest = stat.mtimeMs;
          if (entry.isDirectory() && depth < maxDepth) {
            stack.push({ dir: full, depth: depth + 1 });
          }
        } catch {
          // skip unreadable entries
        }
      }
    }
    return latest;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Pass `agentDir` from `app.ts`**

In `packages/dashboard/src/app.ts` around line 1912, add to the `HeartbeatService` config:

```ts
  agentDir,   // local var — already available in this scope (verified at app.ts:1519)
```

- [ ] **Step 5: Run heartbeat tests to verify all pass**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts`
Expected: PASS (all — including the new "audit log shows recent" test).

- [ ] **Step 6: Build dashboard to verify no TS errors**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts \
        packages/dashboard/src/app.ts
git commit -m "feat(m9.1-s9): use audit-log + lazy run-dir mtime as liveness signals"
```

---

### Task 7: Failing tests — minimum-age gate + recheck before delivering interrupted alert

**Files:**
- Modify: `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts`

> **R2 hardening — why both gate AND recheck:** The recheck alone fires too late in most cases. `tick()` runs `checkStaleJobs()` then `deliverPendingNotifications()` *in the same tick* — by the time recheck runs, the executor likely hasn't finished, so status is still `interrupted`. Add a 60-second minimum-age gate: don't deliver `job_interrupted` until 60s after `created`. This widens the window so the executor has time to finish AND the recheck sees the new status.
>
> Threshold note: 60s is a tradeoff. Too long = real failures alerted late. Too short = doesn't catch fast-recovering jobs. 60s is 2 heartbeat ticks — gives the executor at least one full tick to finish + write `completed` before delivery is attempted.

- [ ] **Step 1: Add the `mockJobService.getJob` mock**

Extend the `mockJobService` declaration (around line 24) to include `getJob`:

```ts
let mockJobService: {
  listJobs: ReturnType<typeof vi.fn>;
  updateJob: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
};
```

In `beforeEach` (around line 36), add `getJob: vi.fn(() => null)` to the mock.

- [ ] **Step 2: Add three failing tests**

Add these tests inside the `describe("HeartbeatService", ...)` block:

```ts
it("delays delivering a fresh job_interrupted notification (minimum-age gate)", async () => {
  // Notification was created 10s ago — well under the 60s gate
  queue.enqueue({
    job_id: "job-fresh-interrupt",
    automation_id: "auto-1",
    type: "job_interrupted",
    summary: "Job interrupted. 0/3 items done.",
    todos_completed: 0,
    todos_total: 3,
    incomplete_items: ["a", "b", "c"],
    resumable: true,
    created: new Date(Date.now() - 10 * 1000).toISOString(),
    delivery_attempts: 0,
  });
  mockJobService.getJob.mockReturnValue(
    makeJob({ id: "job-fresh-interrupt", status: "interrupted" }),
  );

  const hb = createHeartbeat();
  await hb.tick();

  // Alert NOT delivered — too fresh, must age first
  expect(mockCi.alert).not.toHaveBeenCalled();
  // Notification still pending (not moved to delivered/)
  expect(queue.listPending()).toHaveLength(1);
});

it("delivers an aged job_interrupted notification when status is still interrupted", async () => {
  // Notification was created 90s ago — past the 60s gate
  queue.enqueue({
    job_id: "job-truly-stuck",
    automation_id: "auto-1",
    type: "job_interrupted",
    summary: "Job interrupted. 0/3 items done.",
    todos_completed: 0,
    todos_total: 3,
    incomplete_items: ["a", "b", "c"],
    resumable: true,
    created: new Date(Date.now() - 90 * 1000).toISOString(),
    delivery_attempts: 0,
  });
  mockJobService.getJob.mockReturnValue(
    makeJob({ id: "job-truly-stuck", status: "interrupted" }),
  );

  const hb = createHeartbeat();
  await hb.tick();

  // Real stall — alert delivered
  expect(mockCi.alert).toHaveBeenCalledTimes(1);
  expect(queue.listPending()).toHaveLength(0);
});

it("discards an aged job_interrupted notification if the job has since recovered", async () => {
  queue.enqueue({
    job_id: "job-recovered",
    automation_id: "auto-1",
    type: "job_interrupted",
    summary: "Job interrupted. 0/3 items done.",
    todos_completed: 0,
    todos_total: 3,
    incomplete_items: ["a", "b", "c"],
    resumable: true,
    created: new Date(Date.now() - 90 * 1000).toISOString(),
    delivery_attempts: 0,
  });
  mockJobService.getJob.mockReturnValue(
    makeJob({ id: "job-recovered", status: "completed" }),
  );

  const hb = createHeartbeat();
  await hb.tick();

  // Alert NOT sent — false alarm discarded
  expect(mockCi.alert).not.toHaveBeenCalled();
  expect(queue.listPending()).toHaveLength(0);
  const delivered = fs.readdirSync(path.join(notifDir, "delivered"));
  expect(delivered).toHaveLength(1);
});
```

- [ ] **Step 3: Run tests to verify they fail (red)**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts -t "minimum-age gate"`
Expected: FAIL (alert was called — gate not implemented)

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts -t "discards an aged"`
Expected: FAIL (alert was called — recheck not implemented)

The "delivers an aged" test will likely PASS (current behavior delivers).

---

### Task 8: Implement minimum-age gate + recheck-before-deliver + counter

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts`

- [ ] **Step 1: Add a constant for the gate and a counter**

Near the top of `heartbeat-service.ts`, after the existing imports:

```ts
/** Minimum age before a job_interrupted notification is delivered.
 *  Gives the executor time to finish + write "completed" before we alert,
 *  catching fast-recovering jobs. 60s = 2 heartbeat ticks. */
const INTERRUPTED_MIN_AGE_MS = 60 * 1000;
```

Inside the `HeartbeatService` class, add a counter property (R10 hardening — observability):

```ts
  /** Counter for false-positive prevention. Logged periodically for ops visibility. */
  public falsePositivesDropped = 0;
```

- [ ] **Step 2: Add the gate + recheck branch in `deliverPendingNotifications`**

In `heartbeat-service.ts`, find the `for (const notification of pending)` loop (line 165). Immediately after the `MAX_DELIVERY_ATTEMPTS` check (line 173, before the `// Stage 2` comment), insert:

```ts
      // M9.1-S9: For job_interrupted, two guards before delivery:
      // (a) minimum-age gate — give the executor time to finish.
      // (b) recheck — if status changed away from "interrupted", drop.
      if (notification.type === "job_interrupted") {
        const ageMs = Date.now() - new Date(notification.created).getTime();
        if (ageMs < INTERRUPTED_MIN_AGE_MS) {
          // Too fresh — leave in pending/ for the next tick.
          continue;
        }

        const fresh = this.config.jobService.getJob(notification.job_id);
        if (fresh && fresh.status !== "interrupted") {
          this.falsePositivesDropped++;
          console.log(
            `[Heartbeat] Discarding stale job_interrupted for ${notification.job_id} — job is now "${fresh.status}" (drops=${this.falsePositivesDropped})`,
          );
          this.config.notificationQueue.markDelivered(notification._filename!);
          continue;
        }
      }
```

- [ ] **Step 3: Run heartbeat tests**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts`
Expected: PASS (all — including the 3 new gate/recheck tests).

- [ ] **Step 4: Build dashboard**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts
git commit -m "feat(m9.1-s9): minimum-age gate + recheck before delivering interrupt alerts"
```

---

### Task 9: Failing test — per-automation `health.stale_threshold_ms` override

**Files:**
- Modify: `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("respects per-automation stale_threshold_ms override", async () => {
  const runDir = path.join(tmpDir, "run-long");
  fs.mkdirSync(runDir, { recursive: true });

  // Last activity 9 min ago — exceeds the 5-min global default,
  // but UNDER the 15-min per-automation override.
  writeTodoFile(path.join(runDir, "todos.json"), {
    items: [{ id: "t1", text: "Long research", status: "in_progress", mandatory: false, created_by: "agent" }],
    last_activity: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  });

  mockJobService.listJobs.mockReturnValue([
    makeJob({
      id: "job-long",
      run_dir: runDir,
      automationId: "research-worker",
    }),
  ]);

  // Resolver returns 15-min override for this automation
  const resolveThreshold = vi.fn((automationId: string) =>
    automationId === "research-worker" ? 15 * 60 * 1000 : null,
  );

  const hb = createHeartbeat({ resolveStaleThresholdMs: resolveThreshold });
  await hb.tick();

  expect(resolveThreshold).toHaveBeenCalledWith("research-worker");
  expect(mockJobService.updateJob).not.toHaveBeenCalledWith(
    "job-long",
    expect.objectContaining({ status: "interrupted" }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts -t "stale_threshold_ms override"`
Expected: FAIL (the resolver isn't wired up; the job gets marked interrupted at the global threshold).

---

### Task 10: Implement per-automation threshold override

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts`
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Add `resolveStaleThresholdMs` to `HeartbeatConfig`**

In `heartbeat-service.ts`, add to the `HeartbeatConfig` interface:

```ts
  /** Optional per-automation threshold resolver. Returns null/undefined to use the global default.
   *  Source: AutomationManifest.health.stale_threshold_ms */
  resolveStaleThresholdMs?: (automationId: string) => number | null | undefined;
```

- [ ] **Step 2: Use the resolver in `checkStaleJobs`**

Replace the existing `isStale` line:

```ts
      const threshold =
        this.config.resolveStaleThresholdMs?.(job.automationId) ??
        this.config.staleThresholdMs;
      const isStale = now - lastActivity > threshold;
```

- [ ] **Step 3: Wire the resolver in `app.ts`**

In `packages/dashboard/src/app.ts` near the `HeartbeatService` constructor (line 1912), add to the config:

```ts
  resolveStaleThresholdMs: (automationId: string) => {
    const automation = app.automationManager?.findById(automationId);
    return automation?.manifest.health?.stale_threshold_ms ?? null;
  },
```

- [ ] **Step 4: Run all heartbeat tests**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts`
Expected: PASS

- [ ] **Step 5: Build dashboard**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts \
        packages/dashboard/src/app.ts
git commit -m "feat(m9.1-s9): per-automation health.stale_threshold_ms override"
```

---

### Task 11: Apply 15-min override to known long-running workers

**Files:**
- Modify: `.my_agent/automations/thailand-news-worker.md`
- Modify: `.my_agent/automations/vpn-thailand-research.md` (if frontmatter present)
- Modify: `.my_agent/automations/chiang-mai-events-worker.md` (if frontmatter present)

- [ ] **Step 1: Add `health.stale_threshold_ms: 900000` to the frontmatter of `thailand-news-worker.md`**

Read the file. Insert under existing top-level keys (above the `---` closer):

```yaml
health:
  stale_threshold_ms: 900000  # 15 min — research workers can be silent during model synthesis
```

- [ ] **Step 2: Same for `vpn-thailand-research.md` and `chiang-mai-events-worker.md`**

Only modify if the file already has YAML frontmatter (`---` block at top) and is a research/web-fetch worker.

- [ ] **Step 3: Commit**

```bash
git add .my_agent/automations/thailand-news-worker.md \
        .my_agent/automations/vpn-thailand-research.md \
        .my_agent/automations/chiang-mai-events-worker.md
git commit -m "config(m9.1-s9): bump stale threshold to 15min for research workers"
```

Note: `.my_agent/` is gitignored — this commit may be a no-op for the public repo. That's fine; the change is for the local agent instance. Confirm by running `git status` after — if no files staged, skip the commit.

---

### Task 12: Live smoke test on the running dashboard

- [ ] **Step 1: Restart the dashboard to pick up new code**

Run: `systemctl --user restart nina-dashboard.service`
Expected: service active.

- [ ] **Step 2: Tail the dashboard logs**

Run: `journalctl --user -u nina-dashboard.service -f` in another terminal. Leave running.

- [ ] **Step 3: Manually fire `thailand-news-worker`**

Use the dashboard UI or API to fire the worker. Watch the run dir (set `AGENT_DIR` env var first to your agent dir, e.g. `export AGENT_DIR=$HOME/my_agent/.my_agent`):

```bash
watch -n 5 'ls -la $AGENT_DIR/automations/.runs/thailand-news-worker/ | tail -5'
```

- [ ] **Step 4: Verify no false `job_interrupted` notification fires (observational)**

While the run is in progress (will take 5-10 min for a research worker), confirm:
- The dashboard log does NOT contain `[Heartbeat] Stale job ... marked interrupted` for this job.
- `.my_agent/notifications/pending/` does NOT contain a `job_interrupted` for the run.

⚠️ **R6 caveat:** if the worker happens to finish in <5min, this step passes vacuously. Step 5 is the deterministic check.

- [ ] **Step 5: Deterministic induced-stale test (R6 hardening)**

Verify the audit-log signal protects an active job using a temporary per-automation override (no code change needed — this exercises Layer 4 from Task 11).

Pick a research worker that you can fire on demand (e.g., `thailand-news-worker`). Set its threshold to a tiny value, fire it, watch the journal:

```bash
# 1. Edit the worker's manifest to use a 30s threshold temporarily
WORKER=$AGENT_DIR/automations/thailand-news-worker.md
cp "$WORKER" "$WORKER.bak"
# Manually edit the YAML frontmatter to add:
#   health:
#     stale_threshold_ms: 30000
# (or use yq if available)

# 2. Restart the dashboard so it picks up the new manifest
systemctl --user restart nina-dashboard.service

# 3. Fire the worker (via dashboard UI or API)
# 4. After ~90s of run time, check the journal:
journalctl --user -u nina-dashboard.service --since "2 minutes ago" | grep -i "stale job"
```

Expected: **NO** `[Heartbeat] Stale job ... marked interrupted` line for the active worker, even though `todos.json:last_activity` is older than 30s. The audit-log activity (Layer 1) keeps the job alive past the lowered threshold.

Negative control: temporarily disable the audit hook OR pick a worker with no `sdk_session_id` set. The same scenario should NOW trip the stale check, confirming the audit-log path is what's saving the live case.

```bash
# 5. Restore the manifest
mv "$WORKER.bak" "$WORKER"
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 6: Verify the run completes successfully**

After completion:
- `deliverable.md` exists in the run dir.
- Job status in JSONL is `completed`.
- A single `job_completed` notification was delivered.

- [ ] **Step 7: Smoke-test the minimum-age + recheck path**

Manually create a stale `job_interrupted` notification file in `.my_agent/notifications/pending/` for a known recently-completed job. Set `created` to >60s ago so the gate is past:

```bash
JOB_ID="job-9d6ba79b-dfd5-4471-a889-c50f408e298e"  # the Apr 18 case (already completed)
# created: 90s ago, past the INTERRUPTED_MIN_AGE_MS gate
CREATED=$(date -u -d "90 seconds ago" +%Y-%m-%dT%H:%M:%S.000Z)
cat > /tmp/stale-interrupt.json <<EOF
{
  "job_id": "$JOB_ID",
  "automation_id": "thailand-news-worker",
  "type": "job_interrupted",
  "summary": "Job interrupted. 0/3 items done.",
  "todos_completed": 0,
  "todos_total": 3,
  "incomplete_items": ["a", "b", "c"],
  "resumable": true,
  "created": "$CREATED",
  "delivery_attempts": 0
}
EOF
mv /tmp/stale-interrupt.json $AGENT_DIR/notifications/pending/$(date +%s%3N)-${JOB_ID}.json
```

Wait one heartbeat tick (~30s). Verify:
- Dashboard log shows: `[Heartbeat] Discarding stale job_interrupted for ${JOB_ID} — job is now "completed" (drops=1)`.
- The file moved from `pending/` to `delivered/`.
- Nina did NOT send the user an alert (check the conversation file or WhatsApp).

- [ ] **Step 8: Smoke-test the minimum-age gate**

Same as Step 7 but use `created: $(date -u +%Y-%m-%dT%H:%M:%S.000Z)` (now). The gate should hold the notification for ~60s before the recheck even runs.

Wait 30s. Verify file is STILL in `pending/`. Wait another 60s. Verify recheck then drops it (should be in `delivered/`, log shows the discard).

---

### Task 13: Sprint review writeup

**Files:**
- Create: `docs/sprints/m9.1-s9-heartbeat-liveness-fix/review.md`

- [ ] **Step 1: Write the review**

Document:
1. **Trigger incident** (the Apr 18 thailand-news-worker false alarm) — link to the conversation file and audit log evidence.
2. **Root cause** — `todos.json:last_activity` is touched only by 4 todo MCP tools; non-todo tool calls (WebFetch, browser MCP, Bash, Edit, etc.) leave it stale during legitimate work.
3. **Fix layers shipped** — audit-log liveness, recheck-before-deliver, per-automation threshold.
4. **Skipped** — stream-event heartbeat from executor (deferred unless future false positives appear).
5. **Test coverage delta** — 4 new tests (3 in heartbeat-service.test.ts, 4 in audit-liveness.test.ts).
6. **Smoke results** — link to dashboard log excerpt showing real `thailand-news-worker` run with no false interruption.
7. **Follow-ups** — broaden restart-recovery eligibility for scheduled workers (separate ticket; that's the Apr 7 case).

- [ ] **Step 2: Commit**

```bash
git add docs/sprints/m9.1-s9-heartbeat-liveness-fix/review.md
git commit -m "docs(m9.1-s9): sprint review"
```

---

### Task 14: Update roadmap status

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Mark S9 row as Done**

In the M9.1 sprint table, change the S9 row's status column from `Planned (late addendum, 2026-04-18)` to `Done (late addendum)` and add the review link:

```
| S9 | Heartbeat Liveness Fix | Done (late addendum) | ... [Plan](../sprints/m9.1-s9-heartbeat-liveness-fix/plan.md) · [Review](../sprints/m9.1-s9-heartbeat-liveness-fix/review.md) |
```

- [ ] **Step 2: Update the Quick Status badge for M9.1 (R11 hardening — honesty)**

Find the M9.1 row in the Quick Status table at the top of the roadmap. Change:

```
| **M9.1: Agentic Flow Overhaul** | **Done** | All 8 sprints complete. ...
```

To:

```
| **M9.1: Agentic Flow Overhaul** | **Done + S9 corrective** | 9 sprints — original 8 + S9 (heartbeat false-positive fix, 2026-04-18 addendum).
```

This keeps "Done" honest while signaling the addendum exists.

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(m9.1-s9): mark S9 done in roadmap"
```

---

## Self-Review Checklist (run before declaring sprint done)

- [ ] Core EMITS cleanly: `cd packages/core && npx tsc` (not `--noEmit` — dashboard imports compiled JS)
- [ ] Dashboard typechecks: `cd packages/dashboard && npx tsc --noEmit`
- [ ] All vitest suites green: `cd packages/dashboard && npx vitest run`
- [ ] All NEW tests in this sprint are present and passing:
  - [ ] `audit-liveness.test.ts` — 5 tests (basic, no-match, latest-wins, large-tail, off-tail-window-returns-0, empty-session)
  - [ ] `heartbeat-service.test.ts` — 5 new tests (audit shows recent, neverStarted-still-fires, min-age-gate, aged-still-interrupted-delivers, aged-recovered-discards, threshold-override)
- [ ] No new placeholder TODOs introduced
- [ ] Audit log file path matches what `createAuditHook` writes (`{agentDir}/logs/audit.jsonl`) — confirmed at `packages/core/src/hooks/audit.ts:24`
- [ ] Audit hook IS wired to worker sessions — confirmed at `packages/dashboard/src/app.ts:1525` (`createHooks("task", { agentDir })` includes the PostToolUse audit hook from `packages/core/src/hooks/factory.ts:34-39`)
- [ ] `agentDir` source in `app.ts` line 1912 area uses the same `agentDir` local var the executor uses (line 1519) — sanity check before commit
- [ ] `automationManager` is constructed BEFORE `HeartbeatService` (line 1510 vs 1912) — confirmed
- [ ] `falsePositivesDropped` counter is exported on the HeartbeatService instance (for ops visibility — could be wired to `/health` endpoint in a follow-up)
- [ ] Smoke test (Task 12) passed end-to-end on the live dashboard, including the deterministic induced-stale step (Step 5)

## Risks Accepted (documented, not fixed this sprint)

- **Audit-log tail off-the-back** — under extreme concurrent load (many workers + brain), a worker's recent entries could be pushed out of the 64KB tail. Run-dir mtime (Layer 2) covers this. If still insufficient, future sprint upgrades to chunked backward reads.
- **Subagent silent gaps** — when worker delegates to a subagent, worker-session audit entries pause. Run-dir mtime (Layer 2) covers most cases (subagent file writes through worker process). For pure compute-only subagents with no file activity, the per-automation threshold (Layer 4) is the user's escape hatch.
- **Minimum-age gate adds 60s latency to true positives** — a genuinely-stuck worker takes 60s longer to alert. Acceptable cost; the existing 5-min threshold already implies operators are not waiting on second-by-second alerting.
- **`neverStarted` 2-min hair-trigger unchanged** — explicitly documented in test ("still triggers neverStarted even when audit log shows activity"). Future sprint may add audit-log signal to neverStarted branch.

## Out of Scope (do NOT do this sprint)

- Stream-event heartbeat from executor (`for await` loop touch). Defer unless false positives recur after this sprint.
- Restart-recovery eligibility broadening (the Apr 7 class). Separate ticket.
- Reworking the alert wording template (`heartbeat-service.ts:248-249`). Detection-side fix is sufficient.
- Touching `neverStarted` 2-min hair-trigger (`heartbeat-service.ts:109-111`). Note as follow-up, don't change this sprint.
- Wiring `falsePositivesDropped` to a metrics endpoint or dashboard widget. Counter is exposed; visualization is a separate small task.
