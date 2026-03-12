# M6.6-S3: Passive Learning — Sprint Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nina learns from conversations automatically — facts extracted in background via parallel Haiku call, weekly review promotes recurring facts to reference.

**Architecture:** Add `extractFacts()` as a parallel Haiku call alongside existing abbreviation in `AbbreviationQueue`. Facts persist to `notebook/knowledge/` files (facts.md, people.md, preferences.md). Deduplication via substring matching with search service fallback. Weekly review job added to WorkLoopScheduler. DB migration adds `last_extracted_at_turn` to conversations table. Conversation status change to inactive triggers abbreviation+extraction enqueue.

**Tech Stack:** TypeScript, better-sqlite3, @my-agent/core (createBrainQuery), vitest

**Spec:** `docs/superpowers/specs/2026-03-11-memory-perfection-design.md` (Sprint 3: Passive Learning, sections 3.1-3.6)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/conversations/fact-extractor.ts` | Fact extraction prompt, parsing, persistence to knowledge/ files | Create |
| `src/conversations/abbreviation.ts` | Add parallel extractFacts() via Promise.allSettled, track lastExtractedAtTurn | Modify |
| `src/conversations/db.ts` | Migration: add last_extracted_at_turn column | Modify |
| `src/conversations/types.ts` | Add lastExtractedAtTurn to Conversation type | Modify |
| `src/conversations/manager.ts` | Expose getDb() for fact extractor dedup, enqueue on inactive transition | Modify |
| `src/scheduler/jobs/weekly-review.ts` | Weekly review job: promote, archive, resolve conflicts | Create |
| `src/scheduler/work-loop-scheduler.ts` | Register weekly-review handler, add prompts | Modify |
| `src/ws/chat-handler.ts` | Enqueue abbreviation when conversation goes inactive via /new | Already wired (verify) |
| `tests/fact-extractor.test.ts` | Unit tests for extraction prompt parsing and file writes | Create |
| `tests/abbreviation-extraction.test.ts` | Integration test: parallel extraction + abbreviation | Create |
| `tests/weekly-review.test.ts` | Unit tests for weekly review logic | Create |

All paths relative to `packages/dashboard/`.

---

## Chunk 1: Fact Extractor Core

### Task 1: Create fact extraction module with prompt and parser

The fact extractor takes a conversation transcript, sends it to Haiku, and parses structured facts from the response. Facts are categorized into: location/schedule/events (facts), people (people), preferences (preferences).

**Files:**
- Create: `packages/dashboard/src/conversations/fact-extractor.ts`
- Create: `packages/dashboard/tests/fact-extractor.test.ts`

- [ ] **Step 1: Write the failing test for fact parsing**

Add to `tests/fact-extractor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFacts } from "../src/conversations/fact-extractor.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/fact-extractor.test.ts`
Expected: FAIL - `parseFacts` does not exist

- [ ] **Step 3: Implement parseFacts and extraction prompt**

Create `src/conversations/fact-extractor.ts`:

```typescript
/**
 * Fact Extractor
 *
 * Extracts structured facts from conversation transcripts via Haiku.
 * Facts are categorized and persisted to notebook/knowledge/ files.
 *
 * Runs in parallel with abbreviation (Promise.allSettled) -
 * operates on the original transcript, not the abbreviation output.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { queryHaiku } from "../scheduler/haiku-query.js";

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from conversation transcripts.

STRICT RULES:
1. Output ONLY categorized facts - no preamble, no explanation, no thinking
2. Use ONLY facts explicitly stated in the transcript - NEVER infer or assume
3. One fact per line, prefixed with category tag
4. If no facts to extract, respond with EXACTLY: "NO_FACTS"
5. Write in English regardless of transcript language
6. Do NOT attempt to read files, search, or use tools

Categories:
[FACT] - locations, schedules, travel plans, events, decisions, commitments
[PERSON] - people mentioned (name, context, relationship)
[PREFERENCE] - explicit preferences ("I prefer X", "I love Y", "always do Z")

Examples:
[FACT] User is in Chiang Mai, Thailand until March 15
[FACT] Flying to Krabi on March 15, returning to Tel Aviv on March 20
[PERSON] Kai - local guide in Chiang Mai, booked for temple tour on March 12
[PREFERENCE] Loves pad krapao (found great place near Tha Phae Gate)`;

export const EXTRACTION_USER_PROMPT = `Extract all facts from this conversation transcript.

---

{transcript}`;

export interface ParsedFacts {
  facts: string[];
  people: string[];
  preferences: string[];
}

/**
 * Parse Haiku's structured fact output into categories
 */
export function parseFacts(raw: string): ParsedFacts {
  const result: ParsedFacts = { facts: [], people: [], preferences: [] };

  if (!raw || raw.trim() === "NO_FACTS") {
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[FACT]")) {
      result.facts.push(trimmed.slice("[FACT]".length).trim());
    } else if (trimmed.startsWith("[PERSON]")) {
      result.people.push(trimmed.slice("[PERSON]".length).trim());
    } else if (trimmed.startsWith("[PREFERENCE]")) {
      result.preferences.push(trimmed.slice("[PREFERENCE]".length).trim());
    }
  }

  return result;
}

/**
 * Extract facts from a conversation transcript via Haiku
 */
export async function extractFacts(transcript: string): Promise<ParsedFacts> {
  const prompt = EXTRACTION_USER_PROMPT.replace("{transcript}", transcript);
  const raw = await queryHaiku(prompt, EXTRACTION_SYSTEM_PROMPT);
  return parseFacts(raw);
}

/**
 * Check if a fact already exists in a file (exact substring match).
 * Used as fallback when semantic search is unavailable.
 */
export function factExistsInContent(
  fact: string,
  existingContent: string,
): boolean {
  // Normalize whitespace for comparison
  const normalizedFact = fact.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedContent = existingContent
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalizedContent.includes(normalizedFact);
}

/**
 * Persist extracted facts to notebook/knowledge/ files.
 * Deduplicates using exact substring matching against existing content.
 *
 * @param agentDir - Path to .my_agent directory
 * @param facts - Parsed facts to persist
 * @returns Number of new facts written (after dedup)
 */
export async function persistFacts(
  agentDir: string,
  facts: ParsedFacts,
): Promise<number> {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");
  if (!existsSync(knowledgeDir)) {
    await mkdir(knowledgeDir, { recursive: true });
  }

  let newCount = 0;

  const files: Array<{ path: string; items: string[]; header: string }> = [
    {
      path: join(knowledgeDir, "facts.md"),
      items: facts.facts,
      header: "# Extracted Facts\n\n",
    },
    {
      path: join(knowledgeDir, "people.md"),
      items: facts.people,
      header: "# People\n\n",
    },
    {
      path: join(knowledgeDir, "preferences.md"),
      items: facts.preferences,
      header: "# Preferences\n\n",
    },
  ];

  for (const file of files) {
    if (file.items.length === 0) continue;

    // Read existing content for dedup
    let existing = "";
    if (existsSync(file.path)) {
      existing = await readFile(file.path, "utf-8");
    }

    // Filter out duplicates
    const newItems = file.items.filter(
      (item) => !factExistsInContent(item, existing),
    );

    if (newItems.length === 0) continue;

    // Append new facts
    const timestamp = new Date().toISOString().split("T")[0];
    const lines = newItems.map((item) => `- ${item} _(${timestamp})_`);
    const block = "\n" + lines.join("\n") + "\n";

    if (!existsSync(file.path)) {
      await writeFile(file.path, file.header + block.trimStart(), "utf-8");
    } else {
      await appendFile(file.path, block, "utf-8");
    }

    newCount += newItems.length;
  }

  return newCount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/fact-extractor.test.ts`
Expected: All 3 tests pass

- [ ] **Step 5: Add persistence tests**

Add to `tests/fact-extractor.test.ts`:

```typescript
import { persistFacts, factExistsInContent } from "../src/conversations/fact-extractor.js";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach } from "vitest";

describe("factExistsInContent", () => {
  it("detects exact substring match (case insensitive)", () => {
    const content = "- User is in Chiang Mai, Thailand _(2026-03-11)_\n";
    expect(factExistsInContent("User is in Chiang Mai, Thailand", content)).toBe(true);
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

    const factsContent = readFileSync(join(tmpDir, "notebook", "knowledge", "facts.md"), "utf-8");
    expect(factsContent).toContain("Chiang Mai");

    const peopleContent = readFileSync(join(tmpDir, "notebook", "knowledge", "people.md"), "utf-8");
    expect(peopleContent).toContain("Kai");

    const prefsContent = readFileSync(join(tmpDir, "notebook", "knowledge", "preferences.md"), "utf-8");
    expect(prefsContent).toContain("pad krapao");
  });

  it("deduplicates - does not write existing facts", async () => {
    const factsPath = join(tmpDir, "notebook", "knowledge", "facts.md");
    writeFileSync(factsPath, "# Extracted Facts\n\n- User is in Chiang Mai _(2026-03-11)_\n");

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
```

- [ ] **Step 6: Run all tests to verify**

Run: `cd packages/dashboard && npx vitest run tests/fact-extractor.test.ts`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/conversations/fact-extractor.ts packages/dashboard/tests/fact-extractor.test.ts
git commit -m "feat(m6.6-s3): add fact extractor with parsing and persistence"
```

---

## Chunk 2: DB Migration + Abbreviation Integration

### Task 2: Add lastExtractedAtTurn column and wire into AbbreviationQueue

Add the `last_extracted_at_turn` column to conversations, update the Conversation type, and modify `AbbreviationQueue` to run fact extraction in parallel with abbreviation via `Promise.allSettled`.

**Files:**
- Modify: `packages/dashboard/src/conversations/types.ts`
- Modify: `packages/dashboard/src/conversations/db.ts`
- Modify: `packages/dashboard/src/conversations/abbreviation.ts`
- Modify: `packages/dashboard/src/conversations/manager.ts`
- Create: `packages/dashboard/tests/abbreviation-extraction.test.ts`

- [ ] **Step 1: Add lastExtractedAtTurn to Conversation type**

In `packages/dashboard/src/conversations/types.ts`, add after `lastRenamedAtTurn`:

```typescript
  /** Turn count at last fact extraction (null if never extracted) */
  lastExtractedAtTurn: number | null;
```

- [ ] **Step 2: Add DB migration for last_extracted_at_turn**

In `packages/dashboard/src/conversations/db.ts`, add after the `status` migration block (after line ~132):

```typescript
    // Migration: add last_extracted_at_turn for fact extraction tracking (M6.6-S3)
    if (!columns.some((c) => c.name === "last_extracted_at_turn")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN last_extracted_at_turn INTEGER DEFAULT NULL",
      );
    }
```

Also update `insertConversation` to include the new column if it constructs SQL (check the method). And update the row-to-object mapping function to include `lastExtractedAtTurn`.

- [ ] **Step 3: Update ConversationManager.create() to include new field**

In `packages/dashboard/src/conversations/manager.ts`, add to the Conversation object in `create()`:

```typescript
      lastExtractedAtTurn: null,
```

- [ ] **Step 4: Wire fact extraction into AbbreviationQueue**

Modify `packages/dashboard/src/conversations/abbreviation.ts`:

Add import at top:
```typescript
import { extractFacts, persistFacts } from "./fact-extractor.js";
```

Add `agentDir` to constructor:
```typescript
  private agentDir: string;

  constructor(manager: ConversationManager, apiKey: string, agentDir: string) {
    this.manager = manager;
    this.apiKey = apiKey;
    this.agentDir = agentDir;
    this.namingService = new NamingService();
  }
```

Replace the Haiku call section in `abbreviateConversation()` (the `try` block starting at ~line 148) with `Promise.allSettled` for parallel execution. The key change is wrapping the existing abbreviation call and a new extraction call:

```typescript
    try {
      // Check if extraction is needed (new turns since last extraction)
      const needsExtraction =
        conversation.lastExtractedAtTurn === null ||
        conversation.turnCount > conversation.lastExtractedAtTurn;

      // Run abbreviation and fact extraction in parallel
      // Both operate on the ORIGINAL transcript, not chained
      const [abbreviationResult, extractionResult] = await Promise.allSettled([
        this.generateAbbreviation(transcriptText),
        needsExtraction
          ? this.extractAndPersistFacts(conversationId, transcriptText, conversation.turnCount)
          : Promise.resolve(null),
      ]);

      this.currentQuery = null;

      // Handle abbreviation result
      if (abbreviationResult.status === "fulfilled" && abbreviationResult.value) {
        const abbreviationText = abbreviationResult.value;

        // Check if turn count changed during processing
        const conversationAfter = await this.manager.get(conversationId);
        if (
          conversationAfter &&
          conversationAfter.turnCount !== turnCountBefore
        ) {
          console.warn(
            `Conversation ${conversationId} was updated during abbreviation, re-queuing`,
          );
          this.enqueue(conversationId);
          return;
        }

        await this.manager.setAbbreviation(conversationId, abbreviationText);
        console.log(`Generated abbreviation for conversation ${conversationId}`);
      } else if (abbreviationResult.status === "rejected") {
        console.error(`Abbreviation failed for ${conversationId}:`, abbreviationResult.reason);
        throw abbreviationResult.reason;
      }

      // Log extraction result (non-fatal)
      if (extractionResult.status === "rejected") {
        console.error(`Fact extraction failed for ${conversationId}:`, extractionResult.reason);
      } else if (extractionResult.status === "fulfilled" && extractionResult.value !== null) {
        console.log(`Extracted facts for conversation ${conversationId}: ${extractionResult.value} new facts`);
      }
```

Extract the existing Haiku call into a separate private method:

```typescript
  /**
   * Generate abbreviation text via Haiku (extracted from abbreviateConversation)
   */
  private async generateAbbreviation(transcriptText: string): Promise<string> {
    const fullPrompt = `${ABBREVIATION_PROMPT}\n\n---\n\nConversation transcript:\n\n${transcriptText}`;

    const query = createBrainQuery(fullPrompt, {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are a conversation summarizer.",
      continue: false,
      includePartialMessages: false,
    });

    this.currentQuery = query;

    let abbreviationText = "";

    for await (const msg of query) {
      if (msg.type === "assistant") {
        const message = (
          msg as {
            message?: {
              content?: Array<{ type: string; text?: string }>;
            };
          }
        ).message;
        if (message?.content) {
          for (const block of message.content) {
            if (block.type === "text" && block.text) {
              abbreviationText += block.text;
            }
          }
        }
      } else if (msg.type === "result") {
        const result = msg as { result?: string };
        if (!abbreviationText && result.result) {
          abbreviationText = result.result;
        }
        break;
      }
    }

    if (!abbreviationText.trim()) {
      throw new Error("Generated empty abbreviation");
    }

    return abbreviationText;
  }

  /**
   * Extract facts from transcript and persist to knowledge/ files
   */
  private async extractAndPersistFacts(
    conversationId: string,
    transcriptText: string,
    turnCount: number,
  ): Promise<number> {
    const facts = await extractFacts(transcriptText);
    const newCount = await persistFacts(this.agentDir, facts);

    // Update lastExtractedAtTurn
    await this.manager.update(conversationId, {
      lastExtractedAtTurn: turnCount,
    });

    return newCount;
  }
```

The rename logic that follows the abbreviation should remain unchanged - it runs after both parallel tasks complete.

- [ ] **Step 5: Update all AbbreviationQueue constructor calls**

Search the codebase for `new AbbreviationQueue(` and add the `agentDir` parameter. This is likely in `packages/dashboard/src/ws/chat-handler.ts` or `packages/dashboard/src/index.ts`. Find all callsites and update them.

- [ ] **Step 6: Write integration test**

Create `packages/dashboard/tests/abbreviation-extraction.test.ts`:

```typescript
/**
 * Integration test: verify fact extraction parsing and persistence
 * works correctly in the abbreviation pipeline context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFacts, persistFacts } from "../src/conversations/fact-extractor.js";

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
    expect(existsSync(join(tmpDir, "notebook", "knowledge", "facts.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "notebook", "knowledge", "people.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "notebook", "knowledge", "preferences.md"))).toBe(true);
  });

  it("deduplication prevents double-writes", async () => {
    const parsed = parseFacts("[FACT] User is in Chiang Mai");

    await persistFacts(tmpDir, parsed);
    const count2 = await persistFacts(tmpDir, parsed);
    expect(count2).toBe(0); // No new facts

    const content = readFileSync(join(tmpDir, "notebook", "knowledge", "facts.md"), "utf-8");
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
```

- [ ] **Step 7: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/abbreviation-extraction.test.ts tests/fact-extractor.test.ts`
Expected: All pass

- [ ] **Step 8: Run TypeScript check**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean (the new `lastExtractedAtTurn` field must be handled in all Conversation object construction sites and DB mappings)

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/conversations/ packages/dashboard/tests/abbreviation-extraction.test.ts
git commit -m "feat(m6.6-s3): wire fact extraction parallel to abbreviation"
```

---

## Chunk 3: Inactive Trigger + Idle Trigger Verification

### Task 3: Verify inactive and idle triggers wire to extraction

When a conversation becomes inactive (new conversation created, or explicit switch), it should be enqueued for abbreviation and extraction. The idle timer (10 min) already triggers abbreviation. Both paths feed into the same `AbbreviationQueue.enqueue()` which now runs extraction in parallel.

**Files:**
- Verify: `packages/dashboard/src/ws/chat-handler.ts` (already calls queueAbbreviationForCurrent)
- Verify: `packages/dashboard/src/conversations/idle-timer.ts` (already enqueues on idle)
- Verify: `packages/dashboard/src/conversations/manager.ts` (create() demotes current)

- [ ] **Step 1: Verify existing inactive trigger wiring**

Read `packages/dashboard/src/ws/chat-handler.ts` - the `queueAbbreviationForCurrent()` function is already called when:
1. `/new` command creates a new conversation (line ~591)
2. Switching to another conversation (line ~636)
3. Last viewer disconnects (line ~470)

This means the inactive trigger is **already wired**. When a conversation goes inactive, `abbreviationQueue.enqueue()` is called, which now runs extraction in parallel.

Verify this by reading the code. If the trigger points are confirmed, document it and move on. No code changes expected for this task.

- [ ] **Step 2: Verify idle timer trigger**

Read `packages/dashboard/src/conversations/idle-timer.ts` - the `onIdle()` method calls `this.queue.enqueue(conversationId)`. This feeds into the same `AbbreviationQueue` that now runs extraction.

Confirm the idle timeout is 10 minutes (600,000ms). If correct, no changes needed.

- [ ] **Step 3: Commit verification note**

```bash
git commit --allow-empty -m "docs(m6.6-s3): verify idle + inactive triggers wire to extraction"
```

---

## Chunk 4: Weekly Review Job

### Task 4: Create weekly review job for fact promotion and conflict resolution

The weekly review reads `knowledge/*` and `reference/*`, promotes facts seen 3+ times, archives stale facts (>30 days, no reinforcement), and resolves conflicts between knowledge and reference.

**Files:**
- Create: `packages/dashboard/src/scheduler/jobs/weekly-review.ts`
- Create: `packages/dashboard/tests/weekly-review.test.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`

- [ ] **Step 1: Write the failing test for weekly review logic**

Create `packages/dashboard/tests/weekly-review.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/weekly-review.test.ts`
Expected: FAIL - module does not exist

- [ ] **Step 3: Implement weekly review module**

Create `packages/dashboard/src/scheduler/jobs/weekly-review.ts`:

```typescript
/**
 * Weekly Review Job
 *
 * Reads knowledge/* and reference/*, then:
 * - Promotes facts seen 3+ times to reference/
 * - Tags facts older than 30 days with no reinforcement as [stale]
 * - Resolves conflicts between knowledge/ and reference/ (via Haiku)
 *
 * The promotion logic is deterministic (count-based).
 * Conflict resolution is Haiku-assisted.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { queryHaiku } from "../haiku-query.js";

export interface ReviewAction {
  action: "promote" | "archive" | "conflict";
  fact: string;
  source: string;
  detail?: string;
}

export const SYSTEM_PROMPT = `You are a knowledge review agent. You analyze extracted facts and produce a structured review.

STRICT RULES:
1. Output ONLY structured review actions - no preamble, no explanation
2. Use ONLY facts from the provided content - NEVER invent or assume
3. One action per line with the tag prefix
4. If no actions needed, respond with EXACTLY: "NO_ACTIONS"

Action types:
[PROMOTE] fact text - this fact appeared 3+ times and should be promoted to reference
[ARCHIVE] fact text - this fact is >30 days old with no recent reinforcement, mark as stale
[CONFLICT] knowledge fact vs reference fact - conflicting information, suggest resolution
[UPDATE_REF] file: field = new value - update a reference file field with newer information`;

export const USER_PROMPT_TEMPLATE = `Review the following knowledge and reference files. Identify promotions, stale facts, and conflicts.

Today's date: {date}

## Knowledge Files
{knowledge}

## Reference Files
{reference}

Instructions:
1. Facts appearing 3+ times in knowledge - [PROMOTE] to reference
2. Facts with dates >30 days ago and no recent repetition - [ARCHIVE] as stale
3. Knowledge contradicts reference - [CONFLICT] with both versions
4. Knowledge has newer info than reference - [UPDATE_REF] with the update`;

/**
 * Analyze knowledge/ files for deterministic review actions.
 * Returns promotion candidates (facts with 3+ occurrences).
 */
export function analyzeKnowledge(agentDir: string): ReviewAction[] {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");
  const actions: ReviewAction[] = [];

  if (!existsSync(knowledgeDir)) return actions;

  // Read all knowledge files
  let files: string[];
  try {
    files = readdirSync(knowledgeDir).filter((f) => f.endsWith(".md"));
  } catch {
    return actions;
  }

  for (const file of files) {
    const content = readFileSync(join(knowledgeDir, file), "utf-8");
    const lines = content
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.replace(/^- /, "").replace(/ _\(.*?\)_$/, "").trim());

    // Count occurrences of each fact (normalized)
    const counts = new Map<string, number>();
    for (const line of lines) {
      const key = line.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    // Flag facts with 3+ occurrences for promotion
    for (const [fact, count] of counts) {
      if (count >= 3) {
        // Find original casing from first occurrence
        const original = lines.find((l) => l.toLowerCase() === fact) || fact;
        actions.push({
          action: "promote",
          fact: original,
          source: file,
          detail: `Seen ${count} times`,
        });
      }
    }
  }

  return actions;
}

/**
 * Apply deterministic promotions: move facts to reference/promoted-facts.md
 */
export function applyPromotions(
  agentDir: string,
  actions: ReviewAction[],
): string[] {
  const referenceDir = join(agentDir, "notebook", "reference");
  const promotions = actions.filter((a) => a.action === "promote");
  const applied: string[] = [];

  if (promotions.length === 0) return applied;

  if (!existsSync(referenceDir)) {
    mkdirSync(referenceDir, { recursive: true });
  }

  const today = new Date().toISOString().split("T")[0];
  const promotedPath = join(referenceDir, "promoted-facts.md");

  for (const promotion of promotions) {
    const line = `- ${promotion.fact} _(promoted ${today})_\n`;

    if (!existsSync(promotedPath)) {
      writeFileSync(promotedPath, `# Promoted Facts\n\n${line}`, "utf-8");
    } else {
      // Check if already promoted
      const existing = readFileSync(promotedPath, "utf-8");
      if (existing.toLowerCase().includes(promotion.fact.toLowerCase())) {
        continue; // Already promoted
      }
      appendFileSync(promotedPath, line, "utf-8");
    }

    applied.push(`Promoted: ${promotion.fact} (${promotion.detail})`);
  }

  return applied;
}

/**
 * Run the full weekly review via Haiku.
 * Combines deterministic analysis with Haiku-powered conflict resolution.
 */
export async function runWeeklyReview(agentDir: string): Promise<string> {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");
  const referenceDir = join(agentDir, "notebook", "reference");

  // Read knowledge files
  let knowledgeContent = "";
  if (existsSync(knowledgeDir)) {
    const files = readdirSync(knowledgeDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      knowledgeContent += `### ${file}\n${readFileSync(join(knowledgeDir, file), "utf-8")}\n\n`;
    }
  }

  // Read reference files
  let referenceContent = "";
  if (existsSync(referenceDir)) {
    const files = readdirSync(referenceDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      referenceContent += `### ${file}\n${readFileSync(join(referenceDir, file), "utf-8")}\n\n`;
    }
  }

  if (!knowledgeContent.trim()) {
    return "No knowledge files to review.";
  }

  // Step 1: Deterministic promotions
  const deterministicActions = analyzeKnowledge(agentDir);
  const appliedActions = applyPromotions(agentDir, deterministicActions);

  // Step 2: Haiku-assisted conflict resolution and archiving
  const today = new Date().toISOString().split("T")[0];
  const prompt = USER_PROMPT_TEMPLATE
    .replace("{date}", today)
    .replace("{knowledge}", knowledgeContent || "(empty)")
    .replace("{reference}", referenceContent || "(empty)");

  const response = await queryHaiku(prompt, SYSTEM_PROMPT);

  const summary = appliedActions.length > 0
    ? `Applied ${appliedActions.length} promotions:\n${appliedActions.map((a) => `- ${a}`).join("\n")}\n\nHaiku review:\n${response}`
    : `No promotions needed.\n\nHaiku review:\n${response}`;

  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/weekly-review.test.ts`
Expected: All tests pass

- [ ] **Step 5: Add promotion application test**

Add to `tests/weekly-review.test.ts`:

```typescript
import { applyPromotions } from "../src/scheduler/jobs/weekly-review.js";

describe("applyPromotions", () => {
  // Use same tmpDir setup from above describe block

  it("writes promoted facts to reference/promoted-facts.md", () => {
    const actions = [
      { action: "promote" as const, fact: "User is in Chiang Mai", source: "facts.md", detail: "Seen 3 times" },
    ];

    const applied = applyPromotions(tmpDir, actions);
    expect(applied).toHaveLength(1);

    const promotedPath = join(tmpDir, "notebook", "reference", "promoted-facts.md");
    expect(existsSync(promotedPath)).toBe(true);
    const content = readFileSync(promotedPath, "utf-8");
    expect(content).toContain("Chiang Mai");
    expect(content).toContain("promoted");
  });

  it("does not duplicate already-promoted facts", () => {
    const promotedPath = join(tmpDir, "notebook", "reference", "promoted-facts.md");
    writeFileSync(promotedPath, "# Promoted Facts\n\n- User is in Chiang Mai _(promoted 2026-03-10)_\n");

    const actions = [
      { action: "promote" as const, fact: "User is in Chiang Mai", source: "facts.md", detail: "Seen 3 times" },
    ];

    const applied = applyPromotions(tmpDir, actions);
    expect(applied).toHaveLength(0); // Already promoted

    const content = readFileSync(promotedPath, "utf-8");
    const matches = content.match(/Chiang Mai/g);
    expect(matches).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/weekly-review.test.ts`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/scheduler/jobs/weekly-review.ts packages/dashboard/tests/weekly-review.test.ts
git commit -m "feat(m6.6-s3): add weekly review job with promotion and analysis"
```

---

### Task 5: Register weekly review in WorkLoopScheduler

Add the weekly review handler to the scheduler's switch statement and export its prompts.

**Files:**
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`

- [ ] **Step 1: Add weekly review import and handler**

In `packages/dashboard/src/scheduler/work-loop-scheduler.ts`:

Add import:
```typescript
import {
  runWeeklyReview,
  SYSTEM_PROMPT as REVIEW_SYSTEM,
  USER_PROMPT_TEMPLATE as REVIEW_USER,
} from "./jobs/weekly-review.js";
```

Add to the `JOB_PROMPTS` static:
```typescript
    "weekly-review": { system: REVIEW_SYSTEM, userTemplate: REVIEW_USER },
```

Add case in `runJob()` switch (after `case "daily-summary":`):
```typescript
        case "weekly-review":
          output = await this.handleWeeklyReview();
          break;
```

Add handler method:
```typescript
  /**
   * Weekly Review - reads knowledge + reference, promotes facts, resolves conflicts
   */
  private async handleWeeklyReview(): Promise<string> {
    const notebookDir = join(this.agentDir, "notebook");
    const output = await runWeeklyReview(this.agentDir);

    // Log to daily log
    await this.appendToDailyLog(
      notebookDir,
      `- Weekly review completed (${output.length} chars)`,
    );

    return output;
  }
```

- [ ] **Step 2: Run existing tests to verify no breakage**

Run: `cd packages/dashboard && npx vitest run tests/work-loop-api.test.ts`
Expected: All 10 existing tests pass

- [ ] **Step 3: Run TypeScript check**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "feat(m6.6-s3): register weekly review in work loop scheduler"
```

---

## Chunk 5: Calendar Visibility + Full Suite

### Task 6: Calendar visibility for extraction runs

Fact extraction runs should be logged as work_loop_runs entries so they appear on the system calendar. This is done by having the AbbreviationQueue log extraction results via a callback.

**Files:**
- Modify: `packages/dashboard/src/conversations/abbreviation.ts`
- Modify: wherever AbbreviationQueue is instantiated (likely `src/ws/chat-handler.ts` or `src/index.ts`)

- [ ] **Step 1: Add onExtractionComplete callback to AbbreviationQueue**

In `abbreviation.ts`, add:

```typescript
  /** Callback invoked when fact extraction completes (for calendar visibility) */
  onExtractionComplete?: (result: {
    conversationId: string;
    newFactCount: number;
    durationMs: number;
    error?: string;
  }) => void;
```

In the `extractAndPersistFacts` method, wrap with timing and call the callback:

```typescript
  private async extractAndPersistFacts(
    conversationId: string,
    transcriptText: string,
    turnCount: number,
  ): Promise<number> {
    const startTime = Date.now();
    try {
      const facts = await extractFacts(transcriptText);
      const newCount = await persistFacts(this.agentDir, facts);

      await this.manager.update(conversationId, {
        lastExtractedAtTurn: turnCount,
      });

      const durationMs = Date.now() - startTime;
      this.onExtractionComplete?.({
        conversationId,
        newFactCount: newCount,
        durationMs,
      });

      return newCount;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.onExtractionComplete?.({
        conversationId,
        newFactCount: 0,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
```

- [ ] **Step 2: Wire callback in dashboard initialization**

In the file where `AbbreviationQueue` and `WorkLoopScheduler` are both available, wire the callback to insert a `work_loop_runs` entry. The WorkLoopScheduler needs to expose either its DB or a method to log external runs.

Add to `WorkLoopScheduler`:

```typescript
  /**
   * Log an external run (e.g., fact extraction from abbreviation queue)
   */
  logExternalRun(jobName: string, durationMs: number, output: string, error?: string): void {
    const runId = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, jobName, now, now, error ? "failed" : "completed", durationMs, output, error || null);
  }
```

Then in the initialization code:

```typescript
abbreviationQueue.onExtractionComplete = (result) => {
  workLoopScheduler?.logExternalRun(
    "fact-extraction",
    result.durationMs,
    `Extracted ${result.newFactCount} new facts from conversation ${result.conversationId}`,
    result.error,
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/conversations/abbreviation.ts packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "feat(m6.6-s3): log extraction runs to calendar via work_loop_runs"
```

---

### Task 7: Full test suite verification

- [ ] **Step 1: Run all tests**

```bash
cd packages/dashboard && npx vitest run tests/fact-extractor.test.ts tests/abbreviation-extraction.test.ts tests/weekly-review.test.ts tests/work-loop-api.test.ts tests/work-loop-scheduler.test.ts
```

Expected: All pass

- [ ] **Step 2: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
```

Expected: Clean

- [ ] **Step 3: Prettier**

```bash
cd packages/dashboard && npx prettier --write src/ tests/
```

- [ ] **Step 4: Commit formatting if needed**

```bash
git add -A && git commit -m "style: apply prettier formatting"
```

---

## Dependency Graph

```
T1 (fact extractor core) --> T2 (DB migration + abbreviation integration) --> T3 (verify triggers)
                                                                          --> T4 (weekly review) --> T5 (register in scheduler)
                                                                          --> T6 (calendar visibility) --> T7 (full suite)
```

T1 first (standalone module). T2 depends on T1 (imports fact-extractor). T3 is verification (depends on T2). T4 is independent of T3. T5 depends on T4. T6 depends on T2. T7 verifies everything.
