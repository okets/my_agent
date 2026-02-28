/**
 * TaskExtractor Reproduction & Reliability Test
 *
 * Calls Haiku directly with multi-task prompts to:
 * 1. Reproduce the original bug (concatenated JSON / empty-title)
 * 2. Verify the fix handles multi-task extraction
 * 3. Stress-test for consistency across repeated runs
 *
 * Usage: cd packages/dashboard && npx tsx tests/test-task-extractor.ts
 */

import { findAgentDir, resolveAuth } from "@my-agent/core";
import { extractTaskFromMessage } from "../src/tasks/task-extractor.js";

// Bootstrap auth (same as dashboard index.ts)
const agentDir = findAgentDir();
resolveAuth(agentDir);

// ─── Test Cases ─────────────────────────────────────────────────────────────

const TEST_CASES = [
  {
    name: "Multi-task: two scheduled tasks",
    input:
      "In 1 minute tell me what day it is, and in 2 minutes tell me what month it is",
    expect: {
      shouldCreateTask: true,
      minTasks: 2,
      allScheduled: true,
    },
  },
  {
    name: "Multi-task: three distinct tasks",
    input:
      "In 1 minute check the weather, in 3 minutes remind me to call mom, and in 5 minutes send me a fun fact",
    expect: {
      shouldCreateTask: true,
      minTasks: 3,
      allScheduled: true,
    },
  },
  {
    name: "Single task: research (regression check)",
    input: "Research the best restaurants in Tel Aviv and send me a list",
    expect: {
      shouldCreateTask: true,
      minTasks: 1,
      allScheduled: false,
    },
  },
  {
    name: "Single task: scheduled (regression check)",
    input: "In 5 minutes send me a WhatsApp saying don't forget the meeting",
    expect: {
      shouldCreateTask: true,
      minTasks: 1,
      allScheduled: true,
    },
  },
  {
    name: "No task: simple question",
    input: "What time is it?",
    expect: {
      shouldCreateTask: false,
      minTasks: 0,
      allScheduled: false,
    },
  },
  {
    name: "Multi-task: mixed immediate and scheduled",
    input:
      "Research the top 5 tourist spots in Paris and send me the list, and in 2 minutes remind me to buy groceries",
    expect: {
      shouldCreateTask: true,
      minTasks: 2,
      allScheduled: false, // one immediate, one scheduled
    },
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  run: number;
  pass: boolean;
  details: string;
  taskCount: number;
  rawResult: any;
}

async function runTest(
  tc: (typeof TEST_CASES)[0],
  run: number,
): Promise<TestResult> {
  const result = await extractTaskFromMessage(tc.input);

  const failures: string[] = [];

  // Check shouldCreateTask
  if (result.shouldCreateTask !== tc.expect.shouldCreateTask) {
    failures.push(
      `shouldCreateTask: got ${result.shouldCreateTask}, expected ${tc.expect.shouldCreateTask}`,
    );
  }

  // Count tasks
  const tasks = result.tasks ?? (result.task ? [result.task] : []);
  const taskCount = tasks.length;

  if (tc.expect.shouldCreateTask) {
    if (taskCount < tc.expect.minTasks) {
      failures.push(
        `task count: got ${taskCount}, expected >= ${tc.expect.minTasks}`,
      );
    }

    // Check no empty titles
    const emptyTitles = tasks.filter((t) => !t.title);
    if (emptyTitles.length > 0) {
      failures.push(`${emptyTitles.length} task(s) with empty title`);
    }

    // Check scheduled flag
    if (tc.expect.allScheduled) {
      const nonScheduled = tasks.filter((t) => t.type !== "scheduled");
      if (nonScheduled.length > 0) {
        failures.push(
          `${nonScheduled.length} task(s) not scheduled (expected all scheduled)`,
        );
      }

      // Check scheduledFor is present
      const noTime = tasks.filter(
        (t) => t.type === "scheduled" && !t.scheduledFor,
      );
      if (noTime.length > 0) {
        failures.push(`${noTime.length} scheduled task(s) missing scheduledFor`);
      }
    }

    // Check all tasks have instructions
    const noInstructions = tasks.filter((t) => !t.instructions);
    if (noInstructions.length > 0) {
      failures.push(
        `${noInstructions.length} task(s) with empty instructions`,
      );
    }
  }

  return {
    name: tc.name,
    run,
    pass: failures.length === 0,
    details: failures.length > 0 ? failures.join("; ") : "OK",
    taskCount,
    rawResult: result,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const RUNS_PER_TEST = 3;
  const results: TestResult[] = [];

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  TaskExtractor Reliability Test — ${RUNS_PER_TEST} runs per case`);
  console.log(`${"═".repeat(70)}\n`);

  for (const tc of TEST_CASES) {
    console.log(`▸ ${tc.name}`);
    console.log(`  Input: "${tc.input.substring(0, 70)}..."`);

    for (let run = 1; run <= RUNS_PER_TEST; run++) {
      try {
        const result = await runTest(tc, run);
        results.push(result);

        const icon = result.pass ? "✓" : "✗";
        const tasks =
          result.taskCount > 0
            ? result.rawResult.tasks ?? [result.rawResult.task]
            : [];
        const taskSummary = tasks
          .map(
            (t: any) =>
              `"${t.title}" (${t.type}${t.scheduledFor ? " @ " + t.scheduledFor : ""})`,
          )
          .join(", ");

        console.log(
          `  Run ${run}: ${icon} ${result.details}${taskSummary ? " → " + taskSummary : ""}`,
        );
      } catch (err) {
        console.log(
          `  Run ${run}: ✗ EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
        );
        results.push({
          name: tc.name,
          run,
          pass: false,
          details: `EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
          taskCount: 0,
          rawResult: null,
        });
      }
    }
    console.log();
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log(`${"─".repeat(70)}`);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  console.log(`\n  RESULTS: ${passed}/${total} passed, ${failed} failed`);

  if (failed > 0) {
    console.log(`\n  FAILURES:`);
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`    ${r.name} (run ${r.run}): ${r.details}`);
    }
  }

  const consistency =
    total > 0 ? ((passed / total) * 100).toFixed(0) : "N/A";
  console.log(`\n  Consistency: ${consistency}%`);
  console.log(`${"═".repeat(70)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
