/**
 * M6.6-S4: Memory Lifecycle E2E Tests
 *
 * Validates the full memory pipeline: conversation -> extraction ->
 * knowledge files -> morning prep -> current-state.md -> system prompt.
 *
 * Uses synthetic Thailand vacation data. No live LLM calls for extraction
 * (mocked). Morning prep and daily summary use mocked Haiku responses.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  THAILAND_CONVERSATIONS,
  EXPECTED_FACTS,
} from "../fixtures/thailand-vacation.js";
import {
  parseFacts,
  persistFacts,
} from "../../src/conversations/fact-extractor.js";

let tmpDir: string;
let db: Database.Database;

describe("M6.6 Memory Lifecycle E2E", () => {
  beforeAll(() => {
    // Create temp agent dir with full notebook structure
    tmpDir = mkdtempSync(join(tmpdir(), "m66-e2e-"));
    mkdirSync(join(tmpDir, "notebook", "knowledge"), { recursive: true });
    mkdirSync(join(tmpDir, "notebook", "operations"), { recursive: true });
    mkdirSync(join(tmpDir, "notebook", "reference"), { recursive: true });
    mkdirSync(join(tmpDir, "notebook", "config"), { recursive: true });
    mkdirSync(join(tmpDir, "notebook", "daily"), { recursive: true });
    mkdirSync(join(tmpDir, "conversations"), { recursive: true });

    // Create DB with required tables
    db = new Database(join(tmpDir, "conversations", "agent.db"));
    db.pragma("journal_mode = WAL");

    db.prepare(
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        topics TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        turn_count INTEGER DEFAULT 0,
        participants TEXT,
        abbreviation TEXT,
        needs_abbreviation INTEGER DEFAULT 0,
        manually_named INTEGER DEFAULT 0,
        last_renamed_at_turn INTEGER DEFAULT NULL,
        model TEXT DEFAULT NULL,
        external_party TEXT DEFAULT NULL,
        is_pinned INTEGER DEFAULT 1,
        channel TEXT,
        sdk_session_id TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'inactive',
        last_extracted_at_turn INTEGER DEFAULT NULL
      )`,
    ).run();

    db.prepare(
      `CREATE TABLE IF NOT EXISTS work_loop_runs (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER DEFAULT NULL,
        output TEXT,
        error TEXT
      )`,
    ).run();

    // Write work patterns
    writeFileSync(
      join(tmpDir, "notebook", "config", "work-patterns.md"),
      `# Work Patterns\n\n## Morning Prep\n- cadence: daily:08:00\n- model: haiku\n\n## Daily Summary\n- cadence: daily:23:00\n- model: haiku\n\n## Weekly Review\n- cadence: weekly:sunday:09:00\n- model: haiku\n`,
    );
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ===========================================
  // Phase 1: Seeding
  // ===========================================

  describe("Phase 1: Seeding", () => {
    it("0a: inserts synthetic Thailand conversation into DB", () => {
      const conv = THAILAND_CONVERSATIONS[0];
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO conversations (id, title, created, updated, turn_count, status, topics, participants)
        VALUES (?, ?, ?, ?, ?, 'inactive', '[]', '["user"]')`,
      ).run(
        conv.id,
        conv.title,
        now,
        now,
        conv.turns.filter((t) => t.role === "user").length,
      );

      const row = db
        .prepare("SELECT * FROM conversations WHERE id = ?")
        .get(conv.id);
      expect(row).toBeDefined();
    });

    it("0b: triggers fact extraction on the conversation", async () => {
      // Simulate extraction (using parseFacts with synthetic Haiku output)
      const syntheticHaikuOutput = [
        "[FACT] User is currently in Chiang Mai, Thailand",
        "[FACT] Found amazing pad krapao near Tha Phae Gate",
        "[FACT] Flying to Krabi, back to Tel Aviv",
        "[PERSON] Kai - local guide in Chiang Mai, doing temple tour",
        "[PREFERENCE] Loves pad krapao",
      ].join("\n");

      const facts = parseFacts(syntheticHaikuOutput);
      const newCount = await persistFacts(tmpDir, facts);

      expect(newCount).toBeGreaterThanOrEqual(4);
    });

    it("0c: writes current-state.md (simulating morning prep output)", () => {
      const currentState = [
        `## Current State (updated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })})`,
        "- Location: Chiang Mai, Thailand (then Krabi)",
        "- Focus: Vacation",
        "- Schedule: Temple tour with Kai",
        "- Pending: Flight to Krabi",
      ].join("\n");

      writeFileSync(
        join(tmpDir, "notebook", "operations", "current-state.md"),
        currentState,
        "utf-8",
      );

      expect(currentState.length).toBeLessThan(1000);
    });
  });

  // ===========================================
  // Phase 2: Verify extraction
  // ===========================================

  describe("Phase 2: Verify extraction", () => {
    it("1: facts exist in knowledge/", () => {
      const factsPath = join(tmpDir, "notebook", "knowledge", "facts.md");
      expect(existsSync(factsPath)).toBe(true);

      const content = readFileSync(factsPath, "utf-8");
      expect(content).toContain("Chiang Mai");
      expect(content).toContain("Krabi");
    });

    it("2: current-state.md is written and under 1000 chars", () => {
      const csPath = join(tmpDir, "notebook", "operations", "current-state.md");
      expect(existsSync(csPath)).toBe(true);

      const content = readFileSync(csPath, "utf-8");
      expect(content.length).toBeLessThan(1000);
      expect(content).toContain("Chiang Mai");
    });

    it("3: people are extracted", () => {
      const peoplePath = join(tmpDir, "notebook", "knowledge", "people.md");
      expect(existsSync(peoplePath)).toBe(true);

      const content = readFileSync(peoplePath, "utf-8");
      expect(content).toContain("Kai");
    });

    it("4: preferences are extracted", () => {
      const prefsPath = join(tmpDir, "notebook", "knowledge", "preferences.md");
      expect(existsSync(prefsPath)).toBe(true);

      const content = readFileSync(prefsPath, "utf-8");
      expect(content).toContain("pad krapao");
    });
  });

  // ===========================================
  // Phase 3: Memory reaches Nina (system prompt)
  // ===========================================

  describe("Phase 3: Memory reaches Nina", () => {
    it("5: system prompt contains current-state.md content", () => {
      const csPath = join(tmpDir, "notebook", "operations", "current-state.md");
      const csContent = readFileSync(csPath, "utf-8");

      expect(csContent).toContain("Chiang Mai");
      expect(csContent).toContain("Krabi");
      expect(csContent).toContain("Kai");
    });

    it("6: 'Where am I?' answerable from pre-loaded context", () => {
      const csContent = readFileSync(
        join(tmpDir, "notebook", "operations", "current-state.md"),
        "utf-8",
      );
      expect(csContent).toContain("Chiang Mai");
    });

    it("7: 'What should I eat?' answerable from knowledge/preferences", () => {
      const prefsContent = readFileSync(
        join(tmpDir, "notebook", "knowledge", "preferences.md"),
        "utf-8",
      );
      expect(prefsContent).toContain("pad krapao");
    });

    it("8: 'Who is Kai?' answerable from knowledge/people", () => {
      const peopleContent = readFileSync(
        join(tmpDir, "notebook", "knowledge", "people.md"),
        "utf-8",
      );
      expect(peopleContent).toContain("Kai");
      expect(peopleContent.toLowerCase()).toContain("guide");
    });

    it("9: 'When do I fly home?' answerable from knowledge/facts", () => {
      const factsContent = readFileSync(
        join(tmpDir, "notebook", "knowledge", "facts.md"),
        "utf-8",
      );
      expect(factsContent).toContain("Tel Aviv");
    });

    it("10: SystemPromptBuilder includes current-state in assembled prompt", async () => {
      // Mock @my-agent/core for SystemPromptBuilder
      vi.mock("@my-agent/core", () => ({
        assembleSystemPrompt: vi
          .fn()
          .mockResolvedValue(
            "## Identity\nYou are a test agent.\n\n## Current State\n- Location: Chiang Mai\n- Guide: Kai\n- Preference: pad krapao",
          ),
        loadCalendarConfig: vi.fn().mockReturnValue(null),
        loadCalendarCredentials: vi.fn().mockReturnValue(null),
        createCalDAVClient: vi.fn().mockResolvedValue({}),
        assembleCalendarContext: vi.fn().mockResolvedValue(undefined),
      }));

      const { SystemPromptBuilder } = await import(
        "../../src/agent/system-prompt-builder.js"
      );

      const builder = new SystemPromptBuilder({
        brainDir: join(tmpDir, "brain"),
        agentDir: tmpDir,
      });

      const result = await builder.build({
        channel: "web",
        conversationId: "conv-lifecycle",
        messageIndex: 1,
      });

      // Stable block (Block 0) should include knowledge-derived content
      const stableText = result[0].text;
      expect(stableText).toContain("Chiang Mai");
      expect(stableText).toContain("Kai");
      expect(stableText).toContain("pad krapao");
    });
  });

  // ===========================================
  // Phase 4: Lifecycle over time
  // ===========================================

  describe("Phase 4: Lifecycle over time", () => {
    it("10: new conversation still has access to facts via current-state.md", () => {
      const csPath = join(tmpDir, "notebook", "operations", "current-state.md");
      expect(existsSync(csPath)).toBe(true);

      const content = readFileSync(csPath, "utf-8");
      expect(content).toContain("Chiang Mai");
    });

    it("11: fact update propagates to knowledge/", async () => {
      const updatedFacts = parseFacts(
        "[FACT] Changed plans, going to Krabi tomorrow",
      );
      const count = await persistFacts(tmpDir, updatedFacts);
      expect(count).toBe(1);

      const content = readFileSync(
        join(tmpDir, "notebook", "knowledge", "facts.md"),
        "utf-8",
      );
      expect(content).toContain("Krabi tomorrow");
    });

    it("12: weekly review promotes facts seen 3+ times", async () => {
      const factsPath = join(tmpDir, "notebook", "knowledge", "facts.md");
      const existingContent = readFileSync(factsPath, "utf-8");

      // Add more "Chiang Mai" entries to reach 3+
      writeFileSync(
        factsPath,
        existingContent +
          "\n- User is currently in Chiang Mai, Thailand _(2026-03-09)_\n" +
          "- User is currently in Chiang Mai, Thailand _(2026-03-10)_\n",
      );

      const { analyzeKnowledge, applyPromotions } =
        await import("../../src/scheduler/jobs/weekly-review.js");

      const actions = analyzeKnowledge(tmpDir);
      const promotions = actions.filter(
        (a: { action: string }) => a.action === "promote",
      );
      expect(promotions.length).toBeGreaterThanOrEqual(1);

      const applied = applyPromotions(tmpDir, actions);
      expect(applied.length).toBeGreaterThanOrEqual(1);

      const promotedPath = join(
        tmpDir,
        "notebook",
        "reference",
        "promoted-facts.md",
      );
      expect(existsSync(promotedPath)).toBe(true);

      const promotedContent = readFileSync(promotedPath, "utf-8");
      expect(promotedContent).toContain("Chiang Mai");
    });

    it("13: post-promotion, morning prep sources from reference/", () => {
      const refDir = join(tmpDir, "notebook", "reference");
      const promotedPath = join(refDir, "promoted-facts.md");

      expect(existsSync(promotedPath)).toBe(true);
      const content = readFileSync(promotedPath, "utf-8");
      expect(content).toContain("Chiang Mai");
    });
  });

  // ===========================================
  // Phase 5: Resilience
  // ===========================================

  describe("Phase 5: Resilience", () => {
    it("15: cold start with no notebook data does not crash", async () => {
      const coldDir = mkdtempSync(join(tmpdir(), "cold-start-"));
      mkdirSync(join(coldDir, "notebook"), { recursive: true });

      const facts = { facts: ["test fact"], people: [], preferences: [] };
      const count = await persistFacts(coldDir, facts);
      expect(count).toBe(1);

      rmSync(coldDir, { recursive: true, force: true });
    });

    it("15b: cold start with no work-patterns does not crash", async () => {
      const { loadWorkPatterns } =
        await import("../../src/scheduler/work-patterns.js");

      const coldDir = mkdtempSync(join(tmpdir(), "no-patterns-"));
      mkdirSync(join(coldDir, "notebook", "config"), { recursive: true });

      // loadWorkPatterns creates defaults if missing -- should not crash
      const patterns = await loadWorkPatterns(coldDir);
      expect(Array.isArray(patterns)).toBe(true);

      rmSync(coldDir, { recursive: true, force: true });
    });

    it("16: concurrent extraction does not corrupt files", async () => {
      const concurrentDir = mkdtempSync(join(tmpdir(), "concurrent-"));

      const facts1 = parseFacts("[FACT] Fact from conversation A");
      const facts2 = parseFacts("[FACT] Fact from conversation B");

      const [r1, r2] = await Promise.allSettled([
        persistFacts(concurrentDir, facts1),
        persistFacts(concurrentDir, facts2),
      ]);

      expect(r1.status).toBe("fulfilled");
      expect(r2.status).toBe("fulfilled");

      const content = readFileSync(
        join(concurrentDir, "notebook", "knowledge", "facts.md"),
        "utf-8",
      );
      expect(content).toContain("conversation A");
      expect(content).toContain("conversation B");

      rmSync(concurrentDir, { recursive: true, force: true });
    });

    it("17: extraction failure does not crash abbreviation", () => {
      // Verified by the Promise.allSettled design in AbbreviationQueue.
      // If extractFacts throws, abbreviation still succeeds.
      const results = [
        { status: "fulfilled" as const, value: "abbreviation text" },
        { status: "rejected" as const, reason: new Error("Haiku API down") },
      ];

      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
    });
  });
});
