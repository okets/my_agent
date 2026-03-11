import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeKnowledge,
  applyPromotions,
} from "../src/scheduler/jobs/weekly-review.js";

describe("weekly review analysis", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "weekly-review-"));
    mkdirSync(join(tmpDir, "notebook", "knowledge"), { recursive: true });
    mkdirSync(join(tmpDir, "notebook", "reference"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("identifies facts seen 3+ times for promotion", () => {
    writeFileSync(
      join(tmpDir, "notebook", "knowledge", "facts.md"),
      `# Extracted Facts

- User is in Chiang Mai _(2026-03-05)_
- User is in Chiang Mai _(2026-03-07)_
- User is in Chiang Mai _(2026-03-09)_
- Flying to Krabi _(2026-03-10)_
`,
    );

    const result = analyzeKnowledge(tmpDir);

    const promotions = result.filter((a) => a.action === "promote");
    expect(promotions.length).toBe(1);
    expect(promotions[0].fact).toContain("Chiang Mai");
    expect(promotions[0].detail).toContain("3");
  });

  it("does not promote facts seen fewer than 3 times", () => {
    writeFileSync(
      join(tmpDir, "notebook", "knowledge", "facts.md"),
      `# Extracted Facts

- User is in Chiang Mai _(2026-03-05)_
- User is in Chiang Mai _(2026-03-07)_
- Flying to Krabi _(2026-03-10)_
`,
    );

    const result = analyzeKnowledge(tmpDir);
    const promotions = result.filter((a) => a.action === "promote");
    expect(promotions.length).toBe(0);
  });

  it("handles empty knowledge directory", () => {
    const result = analyzeKnowledge(tmpDir);
    expect(result).toHaveLength(0);
  });

  it("handles missing knowledge directory", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "weekly-fresh-"));
    const result = analyzeKnowledge(freshDir);
    expect(result).toHaveLength(0);
    rmSync(freshDir, { recursive: true, force: true });
  });
});

describe("applyPromotions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "weekly-promo-"));
    mkdirSync(join(tmpDir, "notebook", "knowledge"), { recursive: true });
    mkdirSync(join(tmpDir, "notebook", "reference"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes promoted facts to reference/promoted-facts.md", () => {
    const actions = [
      {
        action: "promote" as const,
        fact: "User is in Chiang Mai",
        source: "facts.md",
        detail: "Seen 3 times",
      },
    ];

    const applied = applyPromotions(tmpDir, actions);
    expect(applied).toHaveLength(1);

    const promotedPath = join(
      tmpDir,
      "notebook",
      "reference",
      "promoted-facts.md",
    );
    expect(existsSync(promotedPath)).toBe(true);
    const content = readFileSync(promotedPath, "utf-8");
    expect(content).toContain("Chiang Mai");
    expect(content).toContain("promoted");
  });

  it("does not duplicate already-promoted facts", () => {
    const promotedPath = join(
      tmpDir,
      "notebook",
      "reference",
      "promoted-facts.md",
    );
    writeFileSync(
      promotedPath,
      "# Promoted Facts\n\n- User is in Chiang Mai _(promoted 2026-03-10)_\n",
    );

    const actions = [
      {
        action: "promote" as const,
        fact: "User is in Chiang Mai",
        source: "facts.md",
        detail: "Seen 3 times",
      },
    ];

    const applied = applyPromotions(tmpDir, actions);
    expect(applied).toHaveLength(0); // Already promoted

    const content = readFileSync(promotedPath, "utf-8");
    const matches = content.match(/Chiang Mai/g);
    expect(matches).toHaveLength(1);
  });
});
