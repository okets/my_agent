#!/usr/bin/env node
/**
 * M9.6-S16 wall-time gate: measure fix-mode Opus run time against at least two plug types.
 *
 * Pre-conditions:
 *   1. source packages/dashboard/.env (or set -a && . packages/dashboard/.env && set +a)
 *   2. Dashboard service running (or App.create() available headlessly)
 *   3. At least two plugs present in .my_agent/capabilities/ with smoke.sh
 *
 * Usage:
 *   node scripts/measure-fix-mode-walltime.js
 *
 * Output:
 *   docs/sprints/m9.6-capability-resilience/s16-walltime-results.md
 *
 * Wall-time decision gate (plan §2.1):
 *   ≤5 min: ship as-is
 *   5–10 min: file proposals/s16-walltime-mitigation.md and choose mitigation
 *   >10 min: escalate to architect
 */

import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CAPABILITIES_DIR = join(process.cwd(), ".my_agent", "capabilities");
const OUTPUT_PATH = join(
  process.cwd(),
  "docs/sprints/m9.6-capability-resilience/s16-walltime-results.md",
);

function findPlugsWithSmoke() {
  if (!existsSync(CAPABILITIES_DIR)) {
    console.error(`Capabilities dir not found: ${CAPABILITIES_DIR}`);
    process.exit(1);
  }
  const entries = readdirSync(CAPABILITIES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(CAPABILITIES_DIR, name, "scripts", "smoke.sh")))
    .map((name) => ({ name, path: join(CAPABILITIES_DIR, name) }));
}

async function main() {
  const plugs = findPlugsWithSmoke();
  console.log(`Found ${plugs.length} plug(s) with smoke.sh:`, plugs.map((p) => p.name));

  if (plugs.length < 2) {
    console.warn("Warning: fewer than 2 plugs found. Wall-time results will be incomplete.");
    console.warn("Install at least one more plug before running this gate.");
  }

  // This script documents the MANUAL steps required on the dev machine.
  // Automated timing requires a live App instance + Opus API key.
  // Steps to run manually:
  //   1. Break a plug surgically (e.g., corrupt config.yaml or revoke an env var).
  //   2. Send a triggering message via the dashboard or headless App.
  //   3. Record wall-time from CFR emit to RESTORED_TERMINAL or SURRENDER.
  //   4. Restore the plug and repeat for a second type.

  const content = `---
sprint: M9.6-S16
gate: wall-time measurement
generated: ${new Date().toISOString()}
---

# S16 Wall-Time Results

**Gate:** plan-phase3-refinements.md §2.1 / design §6.3

## Plugs found at measurement time

${plugs.map((p) => `- \`${p.name}\``).join("\n")}

## Results

| Plug | Type | Break method | Wall-time (s) | Outcome | Decision |
|------|------|-------------|---------------|---------|----------|
| _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |

## Gate decision

- [ ] ≤5 min consistently: ship as-is
- [ ] 5–10 min consistently: file \`proposals/s16-walltime-mitigation.md\`, architect picks mitigation
- [ ] >10 min consistently: escalate — may need architectural change

## How to run

\`\`\`bash
# 1. Load env
set -a && . packages/dashboard/.env && set +a

# 2. For each plug to test:
#    a. Introduce a surgical break (e.g., edit config.yaml to use wrong API key)
#    b. Send a triggering message via dashboard
#    c. Time from CFR ack ("hold on — ...") to restoration or surrender
#    d. Record in the table above
#    e. Verify plug restored (or restore manually if surrendered)

# 3. Fill in the table above and commit
\`\`\`
`;

  writeFileSync(OUTPUT_PATH, content);
  console.log(`Wall-time results template written to: ${OUTPUT_PATH}`);
  console.log("\nNext steps:");
  console.log("  1. Load .env: set -a && . packages/dashboard/.env && set +a");
  console.log("  2. Follow the 'How to run' instructions in the output file.");
  console.log("  3. Fill in the results table and commit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
