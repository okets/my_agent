import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseFacts,
  factExistsInContent,
  persistFacts,
} from "../src/conversations/fact-extractor.js";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseFacts", () => {
  it("parses structured fact output into categories", () => {
    const raw = `[FACT] User is currently in Chiang Mai, Thailand
[FACT] Flying to Krabi on March 15, back to Tel Aviv on March 20
[PERSON] Kai - local guide in Chiang Mai, doing temple tour
[PREFERENCE] Loves pad krapao (found great place near Tha Phae Gate)`;

    const result = parseFacts(raw);

    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toContain("Chiang Mai");
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toContain("Kai");
    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]).toContain("pad krapao");
  });

  it("handles empty or malformed output gracefully", () => {
    const result = parseFacts("");
    expect(result.facts).toHaveLength(0);
    expect(result.people).toHaveLength(0);
    expect(result.preferences).toHaveLength(0);
  });

  it("handles output with no category prefixes", () => {
    const result = parseFacts("Just some random text\nwithout categories");
    expect(result.facts).toHaveLength(0);
    expect(result.people).toHaveLength(0);
    expect(result.preferences).toHaveLength(0);
  });
});

describe("factExistsInContent", () => {
  it("detects exact substring match (case insensitive)", () => {
    const content = "- User is in Chiang Mai, Thailand _(2026-03-11)_\n";
    expect(factExistsInContent("User is in Chiang Mai, Thailand", content)).toBe(
      true,
    );
  });

  it("returns false for non-matching fact", () => {
    const content = "- User is in Chiang Mai _(2026-03-11)_\n";
    expect(factExistsInContent("User is in Bangkok", content)).toBe(false);
  });
});

describe("persistFacts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fact-persist-"));
    mkdirSync(join(tmpDir, "notebook", "knowledge"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes facts to categorized files", async () => {
    const facts = {
      facts: ["User is in Chiang Mai"],
      people: ["Kai - local guide"],
      preferences: ["Loves pad krapao"],
    };

    const count = await persistFacts(tmpDir, facts);
    expect(count).toBe(3);

    const factsContent = readFileSync(
      join(tmpDir, "notebook", "knowledge", "facts.md"),
      "utf-8",
    );
    expect(factsContent).toContain("Chiang Mai");

    const peopleContent = readFileSync(
      join(tmpDir, "notebook", "knowledge", "people.md"),
      "utf-8",
    );
    expect(peopleContent).toContain("Kai");

    const prefsContent = readFileSync(
      join(tmpDir, "notebook", "knowledge", "preferences.md"),
      "utf-8",
    );
    expect(prefsContent).toContain("pad krapao");
  });

  it("deduplicates - does not write existing facts", async () => {
    const factsPath = join(tmpDir, "notebook", "knowledge", "facts.md");
    writeFileSync(
      factsPath,
      "# Extracted Facts\n\n- User is in Chiang Mai _(2026-03-11)_\n",
    );

    const facts = {
      facts: ["User is in Chiang Mai", "Flying to Krabi on March 15"],
      people: [],
      preferences: [],
    };

    const count = await persistFacts(tmpDir, facts);
    expect(count).toBe(1); // Only Krabi is new

    const content = readFileSync(factsPath, "utf-8");
    expect(content).toContain("Krabi");
    // Should not duplicate Chiang Mai
    const matches = content.match(/Chiang Mai/g);
    expect(matches).toHaveLength(1);
  });

  it("creates knowledge dir if missing", async () => {
    const freshDir = mkdtempSync(join(tmpdir(), "fact-fresh-"));
    const facts = { facts: ["test fact"], people: [], preferences: [] };

    const count = await persistFacts(freshDir, facts);
    expect(count).toBe(1);

    rmSync(freshDir, { recursive: true, force: true });
  });

  it("handles empty facts gracefully", async () => {
    const facts = { facts: [], people: [], preferences: [] };
    const count = await persistFacts(tmpDir, facts);
    expect(count).toBe(0);
  });
});
