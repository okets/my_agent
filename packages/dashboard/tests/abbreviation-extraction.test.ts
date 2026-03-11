/**
 * Integration test: verify fact extraction parsing and persistence
 * works correctly in the abbreviation pipeline context.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFacts,
  persistFacts,
} from "../src/conversations/fact-extractor.js";

describe("fact extraction integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "abbrev-extract-"));
    mkdirSync(join(tmpDir, "notebook", "knowledge"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseFacts + persistFacts round-trip works", async () => {
    const raw = `[FACT] User is currently in Chiang Mai, Thailand
[PERSON] Kai - local guide in Chiang Mai
[PREFERENCE] Loves pad krapao`;

    const parsed = parseFacts(raw);
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.people).toHaveLength(1);
    expect(parsed.preferences).toHaveLength(1);

    const count = await persistFacts(tmpDir, parsed);
    expect(count).toBe(3);

    // Verify files exist with content
    expect(existsSync(join(tmpDir, "notebook", "knowledge", "facts.md"))).toBe(
      true,
    );
    expect(existsSync(join(tmpDir, "notebook", "knowledge", "people.md"))).toBe(
      true,
    );
    expect(
      existsSync(join(tmpDir, "notebook", "knowledge", "preferences.md")),
    ).toBe(true);
  });

  it("deduplication prevents double-writes", async () => {
    const parsed = parseFacts("[FACT] User is in Chiang Mai");

    await persistFacts(tmpDir, parsed);
    const count2 = await persistFacts(tmpDir, parsed);
    expect(count2).toBe(0); // No new facts

    const content = readFileSync(
      join(tmpDir, "notebook", "knowledge", "facts.md"),
      "utf-8",
    );
    const matches = content.match(/Chiang Mai/g);
    expect(matches).toHaveLength(1);
  });

  it("skip extraction when no new turns", () => {
    // Logic check: if lastExtractedAtTurn >= turnCount, skip
    const conversation = { lastExtractedAtTurn: 5, turnCount: 5 };
    const needsExtraction =
      conversation.lastExtractedAtTurn === null ||
      conversation.turnCount > conversation.lastExtractedAtTurn;
    expect(needsExtraction).toBe(false);
  });

  it("needs extraction when new turns exist", () => {
    const conversation = { lastExtractedAtTurn: 3, turnCount: 5 };
    const needsExtraction =
      conversation.lastExtractedAtTurn === null ||
      conversation.turnCount > conversation.lastExtractedAtTurn;
    expect(needsExtraction).toBe(true);
  });

  it("needs extraction when never extracted", () => {
    const conversation = { lastExtractedAtTurn: null, turnCount: 5 };
    const needsExtraction =
      conversation.lastExtractedAtTurn === null ||
      conversation.turnCount > conversation.lastExtractedAtTurn;
    expect(needsExtraction).toBe(true);
  });
});
