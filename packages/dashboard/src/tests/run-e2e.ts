/**
 * E2E Test Runner
 *
 * Runs all E2E tests and generates a report.
 */

import { writeFile } from "node:fs/promises";
import { testImmediateTask } from "./e2e-immediate-task.js";
import { testScheduledTask } from "./e2e-scheduled-task.js";
import type { TestResult } from "./test-utils.js";

interface TestReport {
  timestamp: string;
  results: Array<{
    name: string;
    result: TestResult;
    durationMs: number;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

async function runTest(
  name: string,
  fn: () => Promise<TestResult>,
): Promise<{ name: string; result: TestResult; durationMs: number }> {
  console.log(`\n[Test] ${name}`);
  const start = Date.now();

  try {
    const result = await fn();
    const durationMs = Date.now() - start;

    if (result.pass) {
      console.log(`[PASS] ${name} (${durationMs}ms)`);
    } else {
      console.log(`[FAIL] ${name} (${durationMs}ms): ${result.error}`);
    }

    return { name, result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    console.log(`[FAIL] ${name} (${durationMs}ms): ${error}`);
    return {
      name,
      result: { pass: false, error },
      durationMs,
    };
  }
}

async function runE2ETests(): Promise<boolean> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("           M5-S8 E2E Tests — Task System");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Started: ${new Date().toISOString()}`);

  const results: Array<{
    name: string;
    result: TestResult;
    durationMs: number;
  }> = [];

  // Run tests
  results.push(await runTest("Immediate Task", testImmediateTask));
  results.push(await runTest("Scheduled Task", testScheduledTask));

  // Summary
  const passed = results.filter((r) => r.result.pass).length;
  const total = results.length;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`           Results: ${passed}/${total} passed`);
  console.log("═══════════════════════════════════════════════════════════");

  for (const r of results) {
    const status = r.result.pass ? "✓" : "✗";
    console.log(`  ${status} ${r.name}`);
    if (!r.result.pass && r.result.error) {
      console.log(`    Error: ${r.result.error}`);
    }
  }

  // Write report
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total,
      passed,
      failed: total - passed,
    },
  };

  const reportPath = "test-report.json";
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to: ${reportPath}`);

  return passed === total;
}

// Run tests
runE2ETests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
