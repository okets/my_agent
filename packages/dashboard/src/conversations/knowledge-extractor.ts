/**
 * Knowledge Extractor
 *
 * Classifies extracted facts from conversation transcripts via Haiku.
 * Facts are categorized into PERMANENT, TEMPORAL, and PROPERTY types
 * and routed to appropriate destinations.
 *
 * Replaces the S3 fact-extractor.ts pipeline entirely.
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 4
 */

import { queryModel } from "../scheduler/query-model.js";

export const CLASSIFICATION_SYSTEM_PROMPT = `You extract structured facts from conversation transcripts.

STRICT RULES:
1. Output ONLY categorized facts - no preamble, no explanation, no thinking
2. Use ONLY facts explicitly stated in the transcript - NEVER infer or assume
3. One fact per line, prefixed with category tag
4. If no facts to extract, respond with EXACTLY: "NO_FACTS"
5. Write in English regardless of transcript language
6. Do NOT attempt to read files, search, or use tools
7. When a location is mentioned, also extract the IANA timezone inferred from that location with medium confidence. PROPERTY values must be machine-readable — no parenthetical commentary.

Categories:
[PERMANENT:user-info] - biographical: family, identity, birthdays, personal milestones
[PERMANENT:contact] - people: name, relationship, context, contact details if mentioned
[PERMANENT:preference:personal] - lifestyle: food, music, hobbies
[PERMANENT:preference:work] - professional: coding style, tools, process
[PERMANENT:preference:communication] - interaction: tone, language, formality
[TEMPORAL] - current events: travel, meetings, projects, plans with dates
[PROPERTY:key:confidence] - dynamic metadata: location, timezone, availability
  - confidence: high (explicitly stated) | medium (inferred) | low (vague)

Examples:
[PERMANENT:user-info] Has two daughters, Noa (5) and Maya (3)
[PERMANENT:contact] Kai - tour guide in Chiang Mai, arranged through hotel concierge
[PERMANENT:preference:personal] Loves pad krapao, prefers spicy
[PERMANENT:preference:work] Uses TypeScript, prefers functional patterns over OOP
[TEMPORAL] Series A deal signing Tuesday March 18
[TEMPORAL] Flight to Krabi on March 20, returning to Tel Aviv March 25
[PROPERTY:location:high] Currently in Chiang Mai, Thailand
[PROPERTY:timezone:medium] Asia/Bangkok
[PROPERTY:availability:medium] On vacation until late March`;

export const CLASSIFICATION_USER_PROMPT = `Extract all facts from this conversation transcript.

---

{transcript}`;

// --- Types ---

export interface PermanentFact {
  subcategory: string;
  text: string;
}

export interface TemporalFact {
  text: string;
}

export interface PropertyFact {
  key: string;
  value: string;
  confidence: "high" | "medium" | "low";
}

export interface ClassifiedFacts {
  permanent: PermanentFact[];
  temporal: TemporalFact[];
  properties: PropertyFact[];
}

export interface RoutedFacts {
  staging: PermanentFact[];
  dailyLog: TemporalFact[];
  properties: PropertyFact[];
}

// --- Parser ---

export function parseClassifiedFacts(raw: string): ClassifiedFacts {
  const result: ClassifiedFacts = {
    permanent: [],
    temporal: [],
    properties: [],
  };

  if (!raw || raw.trim() === "NO_FACTS") {
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    const permanentMatch = trimmed.match(/^\[PERMANENT:([\w:-]+)\]\s+(.+)$/);
    if (permanentMatch) {
      result.permanent.push({
        subcategory: permanentMatch[1],
        text: permanentMatch[2],
      });
      continue;
    }

    if (trimmed.startsWith("[TEMPORAL]")) {
      result.temporal.push({
        text: trimmed.slice("[TEMPORAL]".length).trim(),
      });
      continue;
    }

    const propertyMatch = trimmed.match(
      /^\[PROPERTY:([\w]+):(high|medium|low)\]\s+(.+)$/,
    );
    if (propertyMatch) {
      result.properties.push({
        key: propertyMatch[1],
        value: propertyMatch[3],
        confidence: propertyMatch[2] as "high" | "medium" | "low",
      });
      continue;
    }
  }

  return result;
}

// --- Router ---

export function routeFacts(classified: ClassifiedFacts): RoutedFacts {
  return {
    staging: classified.permanent,
    dailyLog: classified.temporal,
    properties: classified.properties,
  };
}

// --- Extraction entry point ---

export async function extractClassifiedFacts(
  transcript: string,
): Promise<ClassifiedFacts> {
  const prompt = CLASSIFICATION_USER_PROMPT.replace("{transcript}", transcript);
  const raw = await queryModel(prompt, CLASSIFICATION_SYSTEM_PROMPT, "haiku");
  return parseClassifiedFacts(raw);
}
