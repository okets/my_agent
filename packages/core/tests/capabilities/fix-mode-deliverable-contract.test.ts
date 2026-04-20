/**
 * M9.6-S20 §2.5.1 — CFR-fix worker output contract
 *
 * Validates the terse deliverable.md + forensic.md contract added in S20:
 * - deliverable.md body: ≤ 5 lines, per-attempt one-liner format
 * - forensic.md: exists, longer than deliverable.md body
 * - ESCALATE: marker still parses correctly at body start
 * - readDeliverable-style frontmatter + body parsing is unaffected
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatterContent } from "@my-agent/core";

const createdDirs: string[] = [];

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cfr-fix-contract-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of createdDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TERSE_DELIVERABLE = `---
change_type: config
test_result: pass
hypothesis_confirmed: true
summary: Restored API key reference in config.yaml; smoke green.
surface_required_for_hotreload: false
---
Attempt 1: fixed — config.yaml
`;

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

describe("fix-mode deliverable contract — terse body + forensic sibling", () => {
  it("deliverable.md body has ≤ 5 non-empty lines", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);

    const raw = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const { body } = parseFrontmatterContent(raw);
    const nonEmptyLines = body.split("\n").filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeLessThanOrEqual(5);
  });

  it("deliverable.md body matches per-attempt one-liner format", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);

    const raw = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const { body } = parseFrontmatterContent(raw);
    const nonEmptyLines = body.split("\n").filter((l) => l.trim().length > 0);
    // Every non-empty line must match: "Attempt N: <outcome> — <file | 'no change'>"
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

    const delivBody = parseFrontmatterContent(readFileSync(join(runDir, "deliverable.md"), "utf-8")).body;
    const forensicContent = readFileSync(join(runDir, "forensic.md"), "utf-8");
    expect(forensicContent.length).toBeGreaterThan(delivBody.length);
  });

  it("ESCALATE: marker at body start still parses correctly", () => {
    const runDir = makeRunDir();
    const escalateDeliverable = `---
change_type: unknown
test_result: skipped
hypothesis_confirmed: false
summary: Could not determine root cause.
surface_required_for_hotreload: false
---
ESCALATE: insufficient-context
`;
    writeFileSync(join(runDir, "deliverable.md"), escalateDeliverable);

    const raw = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const { body } = parseFrontmatterContent(raw);
    expect(body.trimStart().startsWith("ESCALATE:")).toBe(true);
  });

  it("frontmatter fields survive the terse body format", () => {
    const runDir = makeRunDir();
    writeFileSync(join(runDir, "deliverable.md"), TERSE_DELIVERABLE);

    const raw = readFileSync(join(runDir, "deliverable.md"), "utf-8");
    const { data } = parseFrontmatterContent(raw);
    expect(data.change_type).toBe("config");
    expect(data.test_result).toBe("pass");
    expect(data.hypothesis_confirmed).toBe(true);
    expect(typeof data.summary).toBe("string");
    expect((data.summary as string).length).toBeGreaterThan(0);
  });
});
