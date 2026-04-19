#!/usr/bin/env node
/**
 * M9.6-S16 wall-time gate: measure fix-mode Opus run time against real plugs.
 *
 * Pre-conditions:
 *   Dashboard running on port 4321 with POST /api/debug/cfr/inject available.
 *   Real plugs surgically broken before running this script.
 *   CLAUDE_CODE_OAUTH_TOKEN set in packages/dashboard/.env.
 *
 * Usage:
 *   node scripts/measure-fix-mode-walltime.js
 *
 * Wall-time gate (plan §2.1):
 *   ≤5 min:   ship as-is (Branch A)
 *   5–10 min: file proposals/s16-walltime-mitigation.md (Branch B)
 *   >10 min:  escalate to architect (Branch C)
 */

import { writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD_BASE = "http://localhost:4321";
const AGENT_DIR = join(process.cwd(), ".my_agent");
const CAPABILITIES_DIR = join(AGENT_DIR, "capabilities");
const RESULTS_PATH = join(
  process.cwd(),
  "docs/sprints/m9.6-capability-resilience/s16-walltime-results.md",
);

// 16-minute timeout per run (JOB_TIMEOUT_MS is 15 min)
const RUN_TIMEOUT_MS = 16 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;

async function apiPost(path, body) {
  const res = await fetch(`${DASHBOARD_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${DASHBOARD_BASE}${path}`);
  return res.json();
}

async function checkDashboard() {
  try {
    await fetch(`${DASHBOARD_BASE}/api/debug/brain/status`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inject a CFR failure and wait for the orchestrator job to complete.
 * Returns { wallTimeMs, status, jobId, summary }.
 */
async function measurePlug({ capabilityType, capabilityName, plugType, symptom, detail }) {
  console.log(`\nMeasuring ${capabilityName} (${capabilityType}, ${plugType})...`);
  console.log(`  Symptom: ${symptom} — ${detail}`);

  // Inject CFR failure through live orchestrator
  const fireStart = Date.now();
  const injectResult = await apiPost("/api/debug/cfr/inject", {
    capabilityType,
    capabilityName,
    symptom,
    detail,
  });

  if (!injectResult.ok) {
    throw new Error(`CFR inject failed: ${injectResult.error}`);
  }

  console.log(`  Failure injected: ${injectResult.failureId}`);
  console.log(`  Polling for job completion (max 16 min)...`);

  // Poll for a job associated with this capabilityType to appear and complete.
  // The orchestrator creates a capability_modify automation job named after the cap.
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let jobId = null;
  let jobStatus = null;
  let jobSummary = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    // List recent jobs and find one for this capability type
    const data = await apiGet(
      `/api/jobs?status=&limit=20`,
    );
    const jobs = data.jobs ?? [];

    // Find the fix-mode job: it will be named after the capability and be recent
    const recent = jobs.filter((j) => {
      const name = (j.automationName ?? "").toLowerCase();
      return (
        name.includes(capabilityName?.toLowerCase() ?? capabilityType) ||
        name.includes(capabilityType.replace(/-/g, " "))
      );
    });

    if (recent.length > 0 && !jobId) {
      jobId = recent[0].id;
      console.log(`  Job found: ${jobId} (${recent[0].automationName})`);
    }

    if (jobId) {
      const job = jobs.find((j) => j.id === jobId);
      if (job && (job.status === "completed" || job.status === "failed")) {
        jobStatus = job.status;
        jobSummary = job.summary;
        break;
      }
    }

    process.stdout.write(".");
  }

  const wallTimeMs = Date.now() - fireStart;

  if (!jobId) {
    console.log("\n  WARNING: No matching job found within timeout window.");
    return { wallTimeMs, status: "no-job-found", jobId: null, summary: null };
  }

  if (!jobStatus) {
    console.log("\n  WARNING: Job did not complete within 16 min timeout.");
    return { wallTimeMs, status: "timeout", jobId, summary: null };
  }

  console.log(`\n  Done. Status: ${jobStatus} | Wall-time: ${Math.round(wallTimeMs / 1000)}s`);
  if (jobSummary) console.log(`  Summary: ${jobSummary.slice(0, 150)}`);

  return { wallTimeMs, status: jobStatus, jobId, summary: jobSummary };
}

function gateDecision(wallTimeMs) {
  const min = wallTimeMs / 60000;
  if (min <= 5) return "A";
  if (min <= 10) return "B";
  return "C";
}

function gateLabel(branch) {
  return branch === "A"
    ? "≤5 min: ship as-is"
    : branch === "B"
      ? "5–10 min: file mitigation proposal"
      : ">10 min: escalate to architect";
}

function writeResults(runs) {
  const rows = runs
    .map(
      (r) =>
        `| ${r.plugName} | ${r.plugType} | ${r.breakMethod} | ${r.wallTimeSec ?? "timeout"} | ${r.status} | ${r.branch} |`,
    )
    .join("\n");

  const allA = runs.every((r) => r.branch === "A");
  const anyB = runs.some((r) => r.branch === "B");
  const anyC = runs.some((r) => r.branch === "C");

  const checkboxes = [
    `- [${allA ? "x" : " "}] ≤5 min consistently: ship as-is`,
    `- [${anyB ? "x" : " "}] 5–10 min consistently: file \`proposals/s16-walltime-mitigation.md\`, architect picks mitigation`,
    `- [${anyC ? "x" : " "}] >10 min consistently: escalate — may need architectural change`,
  ].join("\n");

  const plugList = readdirSync(CAPABILITIES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.includes("walltime-test"))
    .filter((e) => existsSync(join(CAPABILITIES_DIR, e.name, "scripts", "smoke.sh")))
    .map((e) => `- \`${e.name}\``)
    .join("\n");

  const overallBranch =
    anyC ? "C" : anyB ? "B" : "A";

  const content = `---
sprint: M9.6-S16
gate: wall-time measurement
generated: ${new Date().toISOString()}
overall_branch: ${overallBranch}
---

# S16 Wall-Time Results

**Gate:** plan-phase3-refinements.md §2.1 / design §6.3

## Plugs found at measurement time

${plugList}

## Results

| Plug | Type | Break method | Wall-time (s) | Outcome | Decision |
|------|------|-------------|---------------|---------|----------|
${rows}

## Gate decision

${checkboxes}

## Measurement method

Two real plugs were surgically broken and measured end-to-end through the live
recovery orchestrator via \`POST /api/debug/cfr/inject\` (M9.6-S16 Path B endpoint).

- \`tts-edge-tts\`: voice name in \`config.yaml\` changed to \`en-XX-BrokenVoiceXXX\` (invalid voice)
- \`browser-chrome\`: entrypoint in \`CAPABILITY.md\` changed to \`src/server-broken-s16-test.ts\` (missing file)

Wall-time measured from \`cfr.emitFailure()\` call to job \`completed\`/\`failed\` status,
exercising the full \`spawnAutomation\` → automation executor → orchestrator path.
Plugs restored to original state after measurement (backups at \`*.bak\`).
`;

  writeFileSync(RESULTS_PATH, content);
  console.log(`\nResults written to: ${RESULTS_PATH}`);
}

async function main() {
  console.log("M9.6-S16 wall-time gate measurement (real plugs, CFR inject path)\n");

  if (!(await checkDashboard())) {
    console.error("Dashboard not running on port 4321.");
    process.exit(1);
  }
  console.log("Dashboard: online");

  // Two plugs: one script type, one MCP type
  const PLUGS = [
    {
      capabilityType: "text-to-audio",
      capabilityName: "tts-edge-tts",
      plugType: "script",
      symptom: "execution-error",
      detail:
        'edge-tts failed: ValueError: "en-XX-BrokenVoiceXXX" is not a valid voice',
      breakMethod: 'config.yaml voice → "en-XX-BrokenVoiceXXX"',
    },
    {
      capabilityType: "browser-control",
      capabilityName: "browser-chrome",
      plugType: "mcp",
      symptom: "not-installed",
      detail:
        "entrypoint src/server-broken-s16-test.ts not found; npx tsx exited with code 1",
      breakMethod: "CAPABILITY.md entrypoint → missing file",
    },
  ];

  const runs = [];

  for (const plug of PLUGS) {
    const { wallTimeMs, status } = await measurePlug(plug);
    const branch = gateDecision(wallTimeMs);
    runs.push({
      plugName: plug.capabilityName,
      plugType: plug.plugType,
      breakMethod: plug.breakMethod,
      wallTimeSec: Math.round(wallTimeMs / 1000),
      status,
      branch,
    });
    console.log(`  Gate decision: Branch ${branch} — ${gateLabel(branch)}`);
  }

  writeResults(runs);

  console.log("\n=== Summary ===");
  for (const r of runs) {
    console.log(
      `  ${r.plugName}: ${r.wallTimeSec}s — Branch ${r.branch} (${gateLabel(r.branch)})`,
    );
  }

  const overall = runs.some((r) => r.branch === "C")
    ? "C"
    : runs.some((r) => r.branch === "B")
      ? "B"
      : "A";
  console.log(`\nOverall: Branch ${overall} — ${gateLabel(overall)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
