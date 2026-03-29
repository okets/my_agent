/**
 * Live test helpers — shared gates and utilities for real-LLM tests.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

export function requireApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** True if tests were launched from within a Claude Code session */
export const WAS_NESTED = !!process.env.CLAUDECODE;

/**
 * Unset CLAUDECODE env var to allow nested SDK sessions in tests.
 * The Agent SDK refuses to launch inside another Claude Code session.
 */
export function allowNestedSessions(): void {
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_SSE_PORT;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
}

/**
 * Create a temp agent directory with realistic notebook structure
 * for handler tests.
 */
export function createSeededAgentDir(): string {
  const agentDir = mkdtempSync(join(tmpdir(), "live-test-"));

  // Minimal brain structure
  mkdirSync(join(agentDir, "brain"), { recursive: true });
  writeFileSync(
    join(agentDir, "brain", "AGENTS.md"),
    "# Test Agent\nYou are a test assistant for E2E testing.\n",
  );

  // Notebook structure
  const notebookDir = join(agentDir, "notebook");
  mkdirSync(join(notebookDir, "daily"), { recursive: true });
  mkdirSync(join(notebookDir, "summaries", "daily"), { recursive: true });
  mkdirSync(join(notebookDir, "summaries", "weekly"), { recursive: true });
  mkdirSync(join(notebookDir, "summaries", "monthly"), { recursive: true });
  mkdirSync(join(notebookDir, "operations"), { recursive: true });
  mkdirSync(join(notebookDir, "reference"), { recursive: true });
  mkdirSync(join(notebookDir, "properties"), { recursive: true });

  // Seed daily log
  const today = new Date().toISOString().split("T")[0];
  writeFileSync(
    join(notebookDir, "daily", `${today}.md`),
    `# Daily Log — ${today}

08:00 Started working on E2E test verification for the automation system.
09:30 Reviewed sprint plan for M7-S9.
10:00 Running live tests against real LLM backend.
`,
  );

  // Seed user info
  writeFileSync(
    join(notebookDir, "reference", "user-info.md"),
    `# User Info

- Name: Test User
- Role: Developer
- Timezone: UTC
`,
  );

  // Seed properties
  writeFileSync(
    join(notebookDir, "properties", "status.yaml"),
    `location: Test Lab
timezone: UTC
availability: available
`,
  );

  // Automations dir
  mkdirSync(join(agentDir, "automations"), { recursive: true });

  // Runtime dir
  mkdirSync(join(agentDir, "runtime"), { recursive: true });

  return agentDir;
}

/**
 * Seed daily summaries for weekly/monthly handler tests.
 */
export function seedDailySummaries(agentDir: string, count: number): void {
  const summaryDir = join(agentDir, "notebook", "summaries", "daily");
  mkdirSync(summaryDir, { recursive: true });

  for (let i = 1; i <= count; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    writeFileSync(
      join(summaryDir, `${dateStr}.md`),
      `# Daily Summary — ${dateStr}

Worked on automation testing tasks. Completed ${i} test cases.
Key findings: handler dispatch is working correctly with real services.
No blockers encountered.
`,
    );
  }
}

/**
 * Seed a weekly summary for monthly handler tests.
 */
export function seedWeeklySummary(agentDir: string): void {
  const weeklyDir = join(agentDir, "notebook", "summaries", "weekly");
  mkdirSync(weeklyDir, { recursive: true });

  const now = new Date();
  const weekNum = Math.ceil(
    (now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7,
  );
  const yearWeek = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  writeFileSync(
    join(weeklyDir, `${yearWeek}.md`),
    `# Weekly Summary — ${yearWeek}

This week focused on M7-S9 E2E test suite implementation.
Completed headless App tests for the full automation stack.
Browser tests verified calendar and settings UI.
All trigger types (schedule, manual, watch, channel) verified.
`,
  );
}
