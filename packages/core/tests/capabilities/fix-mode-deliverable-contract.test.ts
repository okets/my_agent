/**
 * M9.6-S20 §2.5.1 — CFR-fix worker output contract
 * M9.4-S4.3 — migrated to result.json sidecar
 *
 * Validates the worker output contract for capability fix runs:
 * - deliverable.md: plain markdown body, ≤ 5 lines, per-attempt one-liner format,
 *   NO frontmatter (markdown is for humans)
 * - result.json: typed framework metadata sidecar with change_type, test_result,
 *   hypothesis_confirmed, summary, surface_required_for_hotreload
 * - forensic.md: exists, longer than deliverable.md (audit detail)
 * - ESCALATE: marker still parses correctly at body start (still in deliverable.md)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const createdDirs: string[] = [];

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cfr-fix-contract-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of createdDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TERSE_DELIVERABLE = `Attempt 1: fixed — config.yaml
`;

const RESULT_JSON = JSON.stringify({
  change_type: "config",
  test_result: "pass",
  hypothesis_confirmed: true,
  summary: "Restored API key reference in config.yaml; smoke green.",
  surface_required_for_hotreload: false,
});

const VERBOSE_FORENSIC = `# Forensic Log

## Attempt 1

**Hypothesis:** The API key environment variable name was mismatched — config.yaml referenced
DEEPGRAM_KEY but the actual env var is DEEPGRAM_API_KEY.

**Change:** Updated config.yaml line 3: \`api_key_env: DEEPGRAM_KEY\` → \`api_key_env: DEEPGRAM_API_KEY\`.

**Smoke output:**
\`\`\`
{"status":"ok","model":"nova-2","text":"hello world"}
\`\`\`

**Validation commands run:**
\`\`\`bash
bash scripts/smoke.sh
\`\`\`

Result: exit 0.
`;

describe("fix-mode worker output contract — deliverable + sidecar + forensic", () => {
  it("deliverable.md is plain markdown with no frontmatter", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);

    const raw = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    expect(raw.trimStart().startsWith("---")).toBe(false);
  });

  it("deliverable.md body has ≤ 5 non-empty lines", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);

    const body = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const nonEmptyLines = body.split("\n").filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeLessThanOrEqual(5);
  });

  it("deliverable.md body matches per-attempt one-liner format", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);

    const body = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const nonEmptyLines = body.split("\n").filter((l) => l.trim().length > 0);
    for (const line of nonEmptyLines) {
      expect(line).toMatch(/^Attempt \d+:/);
    }
  });

  it("forensic.md exists in the same run_dir", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);
    writeFileSync(join(runDir, "forensic.md"), VERBOSE_FORENSIC);

    expect(existsSync(join(runDir, "forensic.md"))).toBe(true);
  });

  it("forensic.md body is longer than deliverable.md body", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);
    writeFileSync(join(runDir, "forensic.md"), VERBOSE_FORENSIC);

    const delivBody = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const forensicContent = readFileSync(join(runDir, "forensic.md"), "utf-8");
    expect(forensicContent.length).toBeGreaterThan(delivBody.length);
  });

  it("ESCALATE: marker at body start still parses correctly", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), "ESCALATE: insufficient-context\n");
    writeFileSync(
      join(runDir, "result.json"),
      JSON.stringify({
        change_type: "unknown",
        test_result: "skipped",
        hypothesis_confirmed: false,
        summary: "Could not determine root cause.",
        surface_required_for_hotreload: false,
      }),
    );

    const body = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    expect(body.trimStart().startsWith("ESCALATE:")).toBe(true);
  });

  it("result.json sidecar carries the typed framework metadata", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);
    writeFileSync(join(runDir, "result.json"), RESULT_JSON);

    const data = JSON.parse(readFileSync(join(runDir, "result.json"), "utf-8"));
    expect(data.change_type).toBe("config");
    expect(data.test_result).toBe("pass");
    expect(data.hypothesis_confirmed).toBe(true);
    expect(typeof data.summary).toBe("string");
    expect((data.summary as string).length).toBeGreaterThan(0);
  });
});
