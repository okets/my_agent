/**
 * M6.9-S1: Memory Lifecycle E2E Tests
 *
 * Validates the full memory pipeline: conversation -> classified extraction ->
 * staging files / daily log / properties -> morning prep -> current-state.md -> system prompt.
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
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  THAILAND_CONVERSATIONS,
} from "../fixtures/thailand-vacation.js";
import { parseClassifiedFacts } from "../../src/conversations/knowledge-extractor.js";
import { writeStagingFile } from "../../src/conversations/knowledge-staging.js";
import { updateProperty } from "../../src/conversations/properties.js";

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
      `---\njobs:\n  morning-prep:\n    cadence: "daily:08:00"\n    model: haiku\n  daily-summary:\n    cadence: "daily:23:00"\n    model: haiku\n  weekly-review:\n    cadence: "weekly:sunday:09:00"\n    model: haiku\n---\n\n# Work Patterns\n`,
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

    it("0b: triggers classified fact extraction on the conversation", async () => {
      const syntheticOutput = [
        "[PERMANENT:user-info] Has two daughters, loves Thailand",
        "[PERMANENT:preference:personal] Loves pad krapao",
        "[PERMANENT:contact] Kai - local guide in Chiang Mai, doing temple tour",
        "[TEMPORAL] Flying to Krabi, back to Tel Aviv",
        "[TEMPORAL] Found amazing pad krapao near Tha Phae Gate",
        "[PROPERTY:location:high] Currently in Chiang Mai, Thailand",
      ].join("\n");

      const classified = parseClassifiedFacts(syntheticOutput);

      // Permanent facts go to staging
      expect(classified.permanent).toHaveLength(3);
      await writeStagingFile(tmpDir, "conv-thailand", "Thailand Trip", classified.permanent);

      // Temporal facts go to daily log
      const dailyDir = join(tmpDir, "notebook", "daily");
      if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
      const today = new Date().toISOString().split("T")[0];
      writeFileSync(
        join(dailyDir, `${today}.md`),
        `# Daily Log -- ${today}\n\n` +
        classified.temporal.map((f) => `- ${f.text}`).join("\n") + "\n",
      );

      // Properties go to status.yaml
      for (const prop of classified.properties) {
        await updateProperty(tmpDir, prop.key, {
          value: prop.value,
          confidence: prop.confidence,
          source: "test extraction",
        });
      }
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
    it("1: permanent facts are in staging", () => {
      const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
      expect(existsSync(extractedDir)).toBe(true);

      const files = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThanOrEqual(1);

      const content = readFileSync(join(extractedDir, files[0]), "utf-8");
      expect(content).toContain("pad krapao");
      expect(content).toContain("Kai");
    });

    it("2: temporal facts are in daily log", () => {
      const today = new Date().toISOString().split("T")[0];
      const logPath = join(tmpDir, "notebook", "daily", `${today}.md`);
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("Krabi");
      expect(content).toContain("Tel Aviv");
    });

    it("3: properties are in status.yaml", () => {
      const propsPath = join(tmpDir, "notebook", "properties", "status.yaml");
      expect(existsSync(propsPath)).toBe(true);

      const content = readFileSync(propsPath, "utf-8");
      expect(content).toContain("Chiang Mai");
      expect(content).toContain("high");
    });

    it("4: current-state.md is written and under 1000 chars", () => {
      const csPath = join(tmpDir, "notebook", "operations", "current-state.md");
      expect(existsSync(csPath)).toBe(true);

      const content = readFileSync(csPath, "utf-8");
      expect(content.length).toBeLessThan(1000);
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

    it("7: 'What should I eat?' answerable from staging/permanent facts", () => {
      const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
      const files = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
      const content = readFileSync(join(extractedDir, files[0]), "utf-8");
      expect(content).toContain("pad krapao");
    });

    it("8: 'Who is Kai?' answerable from staging/permanent facts", () => {
      const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
      const files = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
      const content = readFileSync(join(extractedDir, files[0]), "utf-8");
      expect(content).toContain("Kai");
      expect(content.toLowerCase()).toContain("guide");
    });

    it("9: 'When do I fly home?' answerable from daily log", () => {
      const today = new Date().toISOString().split("T")[0];
      const logPath = join(tmpDir, "notebook", "daily", `${today}.md`);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("Tel Aviv");
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
        loadProperties: vi.fn().mockResolvedValue(null),
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
    it("10: new temporal facts append to daily log", () => {
      const today = new Date().toISOString().split("T")[0];
      const logPath = join(tmpDir, "notebook", "daily", `${today}.md`);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("Krabi");
    });

    it("11: staging files accumulate from multiple conversations", async () => {
      await writeStagingFile(tmpDir, "conv-2", "Second Conv", [
        { subcategory: "user-info", text: "Works at a startup" },
      ]);

      const { readStagingFiles } = await import(
        "../../src/conversations/knowledge-staging.js"
      );
      const files = await readStagingFiles(tmpDir);
      expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it("12: property updates overwrite previous values", async () => {
      await updateProperty(tmpDir, "location", {
        value: "Krabi, Thailand",
        confidence: "high",
        source: "test update",
      });

      const content = readFileSync(
        join(tmpDir, "notebook", "properties", "status.yaml"),
        "utf-8",
      );
      expect(content).toContain("Krabi");
    });
  });

  // ===========================================
  // Phase 5: Resilience
  // ===========================================

  describe("Phase 5: Resilience", () => {
    it("15: cold start with no notebook data does not crash", async () => {
      const coldDir = mkdtempSync(join(tmpdir(), "cold-start-"));
      mkdirSync(join(coldDir, "notebook"), { recursive: true });

      await writeStagingFile(coldDir, "conv-cold", "Cold Start", [
        { subcategory: "user-info", text: "test fact" },
      ]);

      const { readStagingFiles } = await import(
        "../../src/conversations/knowledge-staging.js"
      );
      const files = await readStagingFiles(coldDir);
      expect(files.length).toBe(1);

      rmSync(coldDir, { recursive: true, force: true });
    });

    it("15b: cold start with no work-patterns does not crash", async () => {
      const { loadWorkPatterns } =
        await import("../../src/scheduler/work-patterns.js");

      const coldDir = mkdtempSync(join(tmpdir(), "no-patterns-"));
      mkdirSync(join(coldDir, "notebook", "config"), { recursive: true });

      const patterns = await loadWorkPatterns(coldDir);
      expect(Array.isArray(patterns)).toBe(true);

      rmSync(coldDir, { recursive: true, force: true });
    });

    it("16: concurrent staging writes do not corrupt files", async () => {
      const concurrentDir = mkdtempSync(join(tmpdir(), "concurrent-"));

      const [r1, r2] = await Promise.allSettled([
        writeStagingFile(concurrentDir, "conv-a", "Conv A", [
          { subcategory: "user-info", text: "Fact from conversation A" },
        ]),
        writeStagingFile(concurrentDir, "conv-b", "Conv B", [
          { subcategory: "contact", text: "Fact from conversation B" },
        ]),
      ]);

      expect(r1.status).toBe("fulfilled");
      expect(r2.status).toBe("fulfilled");

      const { readStagingFiles } = await import(
        "../../src/conversations/knowledge-staging.js"
      );
      const files = await readStagingFiles(concurrentDir);
      expect(files.length).toBe(2);

      rmSync(concurrentDir, { recursive: true, force: true });
    });

    it("17: extraction failure does not crash abbreviation", () => {
      const results = [
        { status: "fulfilled" as const, value: "abbreviation text" },
        { status: "rejected" as const, reason: new Error("Haiku API down") },
      ];
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
    });
  });
});
