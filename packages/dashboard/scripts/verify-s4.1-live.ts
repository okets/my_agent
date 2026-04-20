/**
 * M9.4-S4.1 live verification script.
 * Exercises the real resolveJobSummaryAsync against today's fixture via the
 * authenticated queryModel → Agent SDK path, with full error visibility.
 *
 * Run:  cd packages/dashboard && npx tsx scripts/verify-s4.1-live.ts
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveJobSummaryAsync } from "../src/automations/summary-resolver.js";
import { queryModel } from "../src/scheduler/query-model.js";

const FIXTURE = new URL("../tests/fixtures/debrief-2026-04-20.md", import.meta.url).pathname;

const EXPECTED_HEADINGS = [
  "cfr-fix-test-type-a1-exec-cee49e8b",
  "cfr-fix-test-type-a2-exec-85e1eae7",
  "cfr-fix-browser-control-a1-exec-fcd0d34d",
  "cfr-fix-text-to-audio-a1-exec-aa89baa4",
  "cfr-fix-test-type-a3-exec-16e00970",
  "cfr-fix-text-to-audio-a2-exec-55a1084c",
  "cfr-fix-browser-control-a2-exec-da70561d",
  "cfr-fix-text-to-audio-a3-exec-029f023c",
  "cfr-fix-browser-control-a3-exec-43146a22",
  "chiang-mai-aqi-worker",
  "expat-tips-worker",
  "project-status-worker",
  "chiang-mai-events-worker",
  "thailand-news-worker",
];

async function main() {
  const fixtureBytes = readFileSync(FIXTURE, "utf-8");
  console.log(`Fixture: ${fixtureBytes.length} bytes at ${FIXTURE}`);

  // Smoke check — does queryModel work at all?
  console.log("\n[1/2] Smoke check: direct queryModel call with tiny prompt");
  try {
    const reply = await queryModel(
      "Say 'ok' and nothing else.",
      "Respond with one word.",
      "haiku",
    );
    console.log(`  Haiku reply: ${JSON.stringify(reply.slice(0, 100))}`);
  } catch (err) {
    console.error("  SMOKE FAILED:", err);
    process.exit(2);
  }

  // Real resolver path
  console.log("\n[2/2] Real resolver: resolveJobSummaryAsync against fixture");
  const tmp = mkdtempSync(join(tmpdir(), "s4.1-verify-"));
  try {
    writeFileSync(join(tmp, "deliverable.md"), fixtureBytes, "utf-8");
    const out = await resolveJobSummaryAsync(tmp, "fallback-unused", queryModel);
    console.log(`  Output length: ${out.length} bytes`);

    const present: string[] = [];
    const missing: string[] = [];
    for (const h of EXPECTED_HEADINGS) {
      if (out.includes(`## ${h}`)) present.push(h);
      else missing.push(h);
    }

    console.log(`\n  Headings present: ${present.length}/${EXPECTED_HEADINGS.length}`);
    if (missing.length > 0) {
      console.log(`  MISSING: ${missing.join(", ")}`);
    }

    const hitCap = out.length <= 10_000;
    console.log(`\n  Length ≤ 10 000: ${hitCap ? "yes" : "NO — " + out.length}`);

    const looksCondensed = out.length < fixtureBytes.length;
    console.log(`  Output < fixture (i.e. condense happened, not raw fallback): ${looksCondensed ? "yes" : "NO — raw-fallback path"}`);

    // Quality spot checks
    const hasAQI = /AQI|157|air quality/i.test(out);
    const hasSongkran = /Songkran/.test(out);
    const hasProject = /S1[89]|M9\.6|Project Status/i.test(out);
    console.log(`\n  Representative facts: AQI=${hasAQI} Songkran=${hasSongkran} Project=${hasProject}`);

    console.log("\n--- CONDENSED OUTPUT (first 4000 chars) ---");
    console.log(out.slice(0, 4000));
    console.log("--- END ---\n");

    const pass = missing.length === 0 && hitCap && looksCondensed;
    console.log(pass ? "VERDICT: PASS" : "VERDICT: FAIL");
    process.exit(pass ? 0 : 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(3);
});
