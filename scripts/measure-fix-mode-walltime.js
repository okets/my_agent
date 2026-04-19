#!/usr/bin/env node
/**
 * M9.6-S16 wall-time gate: measure fix-mode Opus run time.
 *
 * Creates a synthetic broken test capability, fires a MODE:FIX automation
 * against it via the running dashboard HTTP API, and records wall-time.
 *
 * Pre-conditions:
 *   Dashboard running on port 4321 (systemctl --user status nina-dashboard.service)
 *   CLAUDE_CODE_OAUTH_TOKEN set in packages/dashboard/.env
 *
 * Usage:
 *   node scripts/measure-fix-mode-walltime.js
 *
 * Wall-time gate (plan §2.1):
 *   ≤5 min:   ship as-is
 *   5–10 min: file proposals/s16-walltime-mitigation.md
 *   >10 min:  escalate to architect
 */

import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

const DASHBOARD_BASE = "http://localhost:4321";
const AGENT_DIR = join(process.cwd(), ".my_agent");
const AUTOMATIONS_DIR = join(AGENT_DIR, "automations");
const CAPABILITIES_DIR = join(AGENT_DIR, "capabilities");
const RESULTS_PATH = join(
  process.cwd(),
  "docs/sprints/m9.6-capability-resilience/s16-walltime-results.md",
);

// 16-minute total timeout per run (JOB_TIMEOUT_MS is 15 min)
const RUN_TIMEOUT_MS = 16 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

// Test capability that always fails smoke check
const TEST_CAP_ID = "s16-walltime-test-cap";
const TEST_CAP_DIR = join(CAPABILITIES_DIR, TEST_CAP_ID);
const TEST_AUTOMATION_ID = "s16-walltime-fix-test";

function buildModeFixPrompt(capPath) {
  return `MODE: FIX

You have been invoked by the recovery orchestrator because a capability failed.

## Failure Context

- **Capability folder:** \`${capPath}\`
- **Capability:** S16 Walltime Test (type: s16-walltime-test)
- **Symptom:** smoke check exited with code 1
- **Detail:** scripts/smoke.sh returned: "SMOKE FAILED: intentional test failure for S16 wall-time gate"
- **Attempt:** 1/3

## Previous Attempts

_No previous attempts._`;
}

async function apiPost(path, body) {
  const res = await fetch(`${DASHBOARD_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${DASHBOARD_BASE}${path}`);
  return res.json();
}

async function checkDashboardRunning() {
  try {
    await fetch(`${DASHBOARD_BASE}/api/debug/brain/status`);
    return true;
  } catch {
    return false;
  }
}

function createTestCapability() {
  mkdirSync(join(TEST_CAP_DIR, "scripts"), { recursive: true });

  writeFileSync(
    join(TEST_CAP_DIR, "CAPABILITY.md"),
    `---
name: S16 Walltime Test
provides: s16-walltime-test
interface: script
---

Synthetic test capability for M9.6-S16 wall-time gate measurement.
This capability always fails its smoke check so fix-mode has real work to do.
`,
  );

  const smokeScript = `#!/usr/bin/env bash
echo "SMOKE FAILED: intentional test failure for S16 wall-time gate" >&2
exit 1
`;
  writeFileSync(join(TEST_CAP_DIR, "scripts", "smoke.sh"), smokeScript, {
    mode: 0o755,
  });

  console.log(`  Created test capability at: ${TEST_CAP_DIR}`);
}

function createAutomationManifest(capPath) {
  const prompt = buildModeFixPrompt(capPath);
  const manifest = `---
name: S16 Walltime Fix Test
status: active
trigger:
  - type: manual
model: opus
notify: always
autonomy: medium
once: true
system: true
job_type: capability_modify
target_path: ${capPath}
created: ${new Date().toISOString()}
---

${prompt}
`;
  const filePath = join(AUTOMATIONS_DIR, `${TEST_AUTOMATION_ID}.md`);
  writeFileSync(filePath, manifest);
  console.log(`  Wrote automation manifest: ${filePath}`);
  return filePath;
}

async function waitForJobCompletion(automationId) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let jobId = null;

  while (Date.now() < deadline) {
    const data = await apiGet(`/api/automations/${automationId}/jobs`);
    const jobs = data.jobs ?? [];

    if (jobs.length > 0 && !jobId) {
      jobId = jobs[0].id;
      console.log(`  Job created: ${jobId}`);
    }

    if (jobs.length > 0) {
      const job = jobs[0];
      if (job.status === "completed" || job.status === "failed") {
        return { jobId: job.id, status: job.status, summary: job.summary };
      }
    }

    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { jobId, status: "timeout", summary: "Timed out after 16 minutes" };
}

function cleanUp(automationFilePath) {
  try {
    if (existsSync(automationFilePath)) {
      rmSync(automationFilePath);
      console.log(`  Cleaned up: ${automationFilePath}`);
    }
  } catch (e) {
    console.warn(`  Warning: could not remove ${automationFilePath}: ${e.message}`);
  }
  try {
    if (existsSync(TEST_CAP_DIR)) {
      rmSync(TEST_CAP_DIR, { recursive: true });
      console.log(`  Cleaned up test capability: ${TEST_CAP_DIR}`);
    }
  } catch (e) {
    console.warn(`  Warning: could not remove ${TEST_CAP_DIR}: ${e.message}`);
  }
}

function gateDecision(wallTimeMs) {
  const sec = wallTimeMs / 1000;
  const min = sec / 60;
  if (min <= 5) return { label: "≤5 min: ship as-is", branch: "A", checked: 0 };
  if (min <= 10) return { label: "5–10 min: file mitigation proposal", branch: "B", checked: 1 };
  return { label: ">10 min: escalate to architect", branch: "C", checked: 2 };
}

function writeResults(runs) {
  const rows = runs
    .map(
      (r) =>
        `| ${r.plug} | ${r.type} | synthetic smoke.sh exit 1 | ${r.wallTimeSec ?? "_timeout_"} | ${r.outcome} | ${r.decision.branch} |`,
    )
    .join("\n");

  const checkboxes = [
    runs.every((r) => r.decision.branch === "A")
      ? "- [x] ≤5 min consistently: ship as-is"
      : "- [ ] ≤5 min consistently: ship as-is",
    runs.some((r) => r.decision.branch === "B")
      ? "- [x] 5–10 min consistently: file `proposals/s16-walltime-mitigation.md`, architect picks mitigation"
      : "- [ ] 5–10 min consistently: file `proposals/s16-walltime-mitigation.md`, architect picks mitigation",
    runs.some((r) => r.decision.branch === "C")
      ? "- [x] >10 min consistently: escalate — may need architectural change"
      : "- [ ] >10 min consistently: escalate — may need architectural change",
  ].join("\n");

  const plugList = readdirSync(CAPABILITIES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== TEST_CAP_ID)
    .filter((e) => existsSync(join(CAPABILITIES_DIR, e.name, "scripts", "smoke.sh")))
    .map((e) => `- \`${e.name}\``)
    .join("\n");

  const content = `---
sprint: M9.6-S16
gate: wall-time measurement
generated: ${new Date().toISOString()}
---

# S16 Wall-Time Results

**Gate:** plan-phase3-refinements.md §2.1 / design §6.3

## Plugs found at measurement time (real)

${plugList}

## Results

| Plug | Type | Break method | Wall-time (s) | Outcome | Decision |
|------|------|-------------|---------------|---------|----------|
${rows}

## Gate decision

${checkboxes}

## Measurement method

Synthetic test capability (\`s16-walltime-test-cap\`) with \`smoke.sh exit 1\` was created
temporarily. A MODE:FIX automation was written to \`.my_agent/automations/\` and fired via
\`POST /api/automations/:id/fire\`. Wall-time measured from fire request to job
\`completed\`/\`failed\` status in \`GET /api/automations/:id/jobs\`.
`;

  writeFileSync(RESULTS_PATH, content);
  console.log(`\nResults written to: ${RESULTS_PATH}`);
}

async function main() {
  console.log("M9.6-S16 wall-time gate measurement\n");

  if (!(await checkDashboardRunning())) {
    console.error(
      "Dashboard not running on port 4321.\n" +
        "Start with: systemctl --user start nina-dashboard.service",
    );
    process.exit(1);
  }
  console.log("Dashboard: online\n");

  // Create test capability
  console.log("Step 1: Creating synthetic test capability...");
  createTestCapability();

  // Create automation manifest
  console.log("\nStep 2: Creating MODE:FIX automation manifest...");
  const automationFilePath = createAutomationManifest(TEST_CAP_DIR);

  // Fire via HTTP
  console.log("\nStep 3: Firing automation via HTTP...");
  const startMs = Date.now();
  const fireResult = await apiPost(
    `/api/automations/${TEST_AUTOMATION_ID}/fire`,
    {},
  );
  console.log(`  Fire response: ${JSON.stringify(fireResult)}`);

  if (!fireResult.ok) {
    console.error("  Fire failed — check automation manifest format");
    cleanUp(automationFilePath);
    process.exit(1);
  }

  // Poll for completion
  console.log("\nStep 4: Polling for job completion (max 16 min)...");
  const result = await waitForJobCompletion(TEST_AUTOMATION_ID);
  const wallTimeMs = Date.now() - startMs;
  const wallTimeSec = Math.round(wallTimeMs / 1000);
  console.log(`\n  Status: ${result.status} | Wall-time: ${wallTimeSec}s`);
  if (result.summary) console.log(`  Summary: ${result.summary}`);

  const decision = gateDecision(wallTimeMs);
  console.log(`  Gate: ${decision.label}`);

  // Clean up
  console.log("\nStep 5: Cleaning up...");
  cleanUp(automationFilePath);

  // Write results
  const runs = [
    {
      plug: TEST_CAP_ID,
      type: "synthetic (script)",
      wallTimeSec: result.status === "timeout" ? null : wallTimeSec,
      outcome: result.status,
      decision,
    },
  ];
  writeResults(runs);

  console.log("\nDone.");
  console.log(`Gate decision: ${decision.label} (Branch ${decision.branch})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
