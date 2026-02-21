/**
 * Ralph Loop Runner — E2E Task Flow Exit Condition
 *
 * Runs the E2E task flow test repeatedly until 3 consecutive passes.
 * Both immediate AND scheduled tasks must pass together in each run.
 *
 * Exit condition: 3 consecutive runs where all tests pass.
 *
 * Usage: npx tsx tests/run-e2e-loop.ts
 */

import {
  preflight,
  testImmediateTask,
  testScheduledTask,
  cleanup,
  type TestResult,
} from "./e2e-task-whatsapp.js";

const TARGET_CONSECUTIVE = 3;
const COOLDOWN_MS = 10_000; // 10s between runs
const MAX_RUNS = 20; // Safety limit — don't loop forever

async function main() {
  console.log("\u2554" + "\u2550".repeat(48) + "\u2557");
  console.log(
    "\u2551  Ralph Loop \u2014 E2E Task Flow Test" + " ".repeat(14) + "\u2551",
  );
  console.log(
    `\u2551  Exit: ${TARGET_CONSECUTIVE} consecutive passes` +
      " ".repeat(24) +
      "\u2551",
  );
  console.log(
    `\u2551  Max runs: ${MAX_RUNS}` + " ".repeat(31) + "\u2551",
  );
  console.log("\u255a" + "\u2550".repeat(48) + "\u255d\n");

  // Pre-flight check
  console.log("Pre-flight checks:");
  const pf = await preflight();
  if (!pf.ok) {
    console.error("\nPre-flight FAILED:");
    for (const issue of pf.issues) {
      console.error(`  \u2717 ${issue}`);
    }
    process.exit(1);
  }
  console.log("  All checks passed\n");

  let consecutivePasses = 0;
  let runNumber = 0;
  const startTime = Date.now();
  const wishlist: string[] = [];

  while (consecutivePasses < TARGET_CONSECUTIVE && runNumber < MAX_RUNS) {
    runNumber++;
    console.log(`\n${"=".repeat(50)}`);
    console.log(
      `Run ${runNumber} (consecutive: ${consecutivePasses}/${TARGET_CONSECUTIVE})`,
    );
    console.log(`${"=".repeat(50)}`);

    let runPassed = true;

    // Test 1: Immediate task
    console.log("\n  [1/2] Immediate Task (Ko Samui)...");
    const r1 = await testImmediateTask();
    printCompact(r1);

    if (!r1.pass) {
      runPassed = false;
      collectWishlist(r1, wishlist);
    }

    // Test 2: Scheduled task
    console.log("\n  [2/2] Scheduled Task (Phuket)...");
    const r2 = await testScheduledTask();
    printCompact(r2);

    if (!r2.pass) {
      runPassed = false;
      collectWishlist(r2, wishlist);
    }

    // Cleanup
    await cleanup(r1);
    await cleanup(r2);

    // Update consecutive counter
    if (runPassed) {
      consecutivePasses++;
      console.log(
        `\n  \u2713 PASS ${consecutivePasses}/${TARGET_CONSECUTIVE}`,
      );
    } else {
      consecutivePasses = 0;
      console.log(`\n  \u2717 FAIL \u2014 counter reset to 0`);
    }

    // Cooldown between runs (unless we're done)
    if (
      consecutivePasses < TARGET_CONSECUTIVE &&
      runNumber < MAX_RUNS
    ) {
      console.log(`  Cooling down ${COOLDOWN_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    }
  }

  const totalTimeMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  if (consecutivePasses >= TARGET_CONSECUTIVE) {
    console.log(
      "\n\u2554" + "\u2550".repeat(48) + "\u2557",
    );
    console.log(
      "\u2551      EXIT CONDITION MET" + " ".repeat(24) + "\u2551",
    );
    console.log(
      `\u2551  ${TARGET_CONSECUTIVE} consecutive passes achieved` +
        " ".repeat(19) +
        "\u2551",
    );
    console.log(
      `\u2551  Total runs: ${runNumber}, Time: ${totalTimeMin}min` +
        " ".repeat(Math.max(0, 23 - totalTimeMin.length - String(runNumber).length)) +
        "\u2551",
    );
    console.log(
      "\u255a" + "\u2550".repeat(48) + "\u255d",
    );
  } else {
    console.error(
      `\n\u2717 Max runs (${MAX_RUNS}) reached without ${TARGET_CONSECUTIVE} consecutive passes.`,
    );
    console.error(`  Best streak ended at run ${runNumber}.`);

    if (wishlist.length > 0) {
      console.error("\n  WISHLIST (gaps to investigate):");
      const unique = Array.from(new Set(wishlist));
      for (const item of unique) {
        console.error(`    - ${item}`);
      }
    }

    process.exit(1);
  }
}

function printCompact(result: TestResult): void {
  const icon = result.pass ? "\u2713" : "\u2717";
  console.log(
    `    ${icon} ${result.name} (${(result.durationMs / 1000).toFixed(1)}s)`,
  );

  for (const a of result.assertions) {
    if (!a.pass) {
      console.log(`      \u2717 ${a.name}: ${a.detail || "failed"}`);
    }
  }

  if (result.error) {
    console.log(`      ERROR: ${result.error}`);
  }
}

function collectWishlist(result: TestResult, wishlist: string[]): void {
  const failed = result.assertions.filter((a) => !a.pass);
  for (const f of failed) {
    wishlist.push(`${result.name}: ${f.name} \u2014 ${f.detail || "needs investigation"}`);
  }
  if (result.error) {
    wishlist.push(`${result.name}: ${result.error}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
