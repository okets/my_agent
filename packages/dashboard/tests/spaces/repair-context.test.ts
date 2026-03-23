import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildRepairContext } from "../../src/spaces/repair-context.js";
import { appendDecision } from "../../src/spaces/decisions.js";
import type { Space } from "@my-agent/core";

function makeSpace(
  dir: string,
  overrides: Partial<Space> = {},
): Space {
  return {
    name: "test-tool",
    manifestDir: dir,
    tags: ["tool"],
    description: "A test tool",
    created: "2026-03-23",
    indexedAt: "2026-03-23",
    runtime: "uv",
    entry: "src/main.py",
    path: dir,
    io: { input: { url: "string" }, output: { results: "stdout" } },
    maintenance: { on_failure: "fix", log: "DECISIONS.md" },
    ...overrides,
  };
}

describe("buildRepairContext", () => {
  let spaceDir: string;

  beforeEach(() => {
    spaceDir = mkdtempSync(join(tmpdir(), "repair-ctx-"));
  });

  it('policy "fix" returns shouldRepair true with DECISIONS.md content', () => {
    // Write some prior decisions
    appendDecision(spaceDir, {
      category: "created",
      summary: "Initial tool setup",
    });

    const space = makeSpace(spaceDir, {
      maintenance: { on_failure: "fix", log: "DECISIONS.md" },
    });
    const result = buildRepairContext(space, "Error: timeout");

    expect(result.shouldRepair).toBe(true);
    expect(result.policy).toBe("fix");
    expect(result.repairPrompt).toContain("Error: timeout");
    expect(result.repairPrompt).toContain("Initial tool setup");
    expect(result.repairPrompt).toContain("ONE attempt");
  });

  it('policy "alert" returns shouldRepair false', () => {
    const space = makeSpace(spaceDir, {
      maintenance: { on_failure: "alert" },
    });
    const result = buildRepairContext(space, "Error: crash");

    expect(result.shouldRepair).toBe(false);
    expect(result.policy).toBe("alert");
    expect(result.repairPrompt).toContain("do NOT attempt repair");
  });

  it('policy "replace" returns shouldRepair false', () => {
    const space = makeSpace(spaceDir, {
      maintenance: { on_failure: "replace" },
    });
    const result = buildRepairContext(space, "Error: crash");

    expect(result.shouldRepair).toBe(false);
    expect(result.policy).toBe("replace");
    expect(result.repairPrompt).toContain("create a new tool space");
  });

  it("missing DECISIONS.md shows (no prior decisions)", () => {
    const space = makeSpace(spaceDir, {
      maintenance: { on_failure: "fix", log: "DECISIONS.md" },
    });
    const result = buildRepairContext(space, "Error: timeout");

    expect(result.shouldRepair).toBe(true);
    expect(result.repairPrompt).toContain("(no prior decisions)");
  });

  it("extracts maintenance rules from SPACE.md body", () => {
    // Write a SPACE.md with maintenance rules section
    writeFileSync(
      join(spaceDir, "SPACE.md"),
      `---
name: test-tool
runtime: uv
entry: src/main.py
maintenance:
  on_failure: fix
  log: DECISIONS.md
created: "2026-03-23"
---

# Test Tool

A tool for testing.

## Maintenance Rules

- Check network connectivity before retrying
- Maximum 3 retries for HTTP errors
`,
    );

    const space = makeSpace(spaceDir, {
      maintenance: { on_failure: "fix", log: "DECISIONS.md" },
    });
    const result = buildRepairContext(space, "HTTP 500 error");

    expect(result.repairPrompt).toContain("Check network connectivity");
    expect(result.repairPrompt).toContain("Maximum 3 retries");
  });

  it("defaults to alert policy when maintenance is undefined", () => {
    const space = makeSpace(spaceDir, { maintenance: undefined });
    const result = buildRepairContext(space, "Error");

    expect(result.shouldRepair).toBe(false);
    expect(result.policy).toBe("alert");
  });
});
