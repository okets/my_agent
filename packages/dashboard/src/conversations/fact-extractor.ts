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
  const normalizedContent = existingContent.toLowerCase().replace(/\s+/g, " ");
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
