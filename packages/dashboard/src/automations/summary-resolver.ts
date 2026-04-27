import fs from "node:fs";
import path from "node:path";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const MAX_LENGTH = 10_000;

const CONDENSE_SYSTEM_PROMPT =
  "Condense this content to fit within 10,000 characters. Do NOT drop any information — " +
  "every finding, number, name, date, and actionable item must be preserved. " +
  "If the content has `## ` section headings written at the top level (aggregator-style " +
  "worker wrappers), every such heading MUST appear in the output in its original order — " +
  "including near-duplicate headings such as retry attempts (e.g. `-a1`, `-a2`, `-a3` " +
  "suffixes). If two sections have near-identical content, keep BOTH headings and under " +
  "the second write a single brief line like 'Same outcome as previous attempt.' — never " +
  "merge two wrapper headings into one. You may compress the body under each heading and " +
  "merge internal subsections, but never drop a top-level wrapper heading. Shorten prose, " +
  "remove filler, use bullets, but keep all substance. Return only the condensed markdown " +
  "— no preamble, no explanation, no meta-commentary about the task.";

/** Strip YAML frontmatter from markdown content, returning body text only. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "").trim();
}

function readAndStrip(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return null;
    const stripped = stripFrontmatter(raw);
    if (!stripped) return null;
    return stripped;
  } catch {
    return null;
  }
}

/**
 * Resolve a job summary from disk artifacts, with fallback.
 * Returns { text, source } so callers can distinguish disk hits from fallbacks.
 */
function resolve(
  runDir: string | undefined | null,
  fallbackWork: string,
): { text: string; source: "deliverable" | "status-report" | "fallback" } {
  if (!runDir) {
    console.log(`[summary-resolver] No runDir — using fallback (${fallbackWork.length} chars)`);
    return { text: fallbackWork, source: "fallback" };
  }

  const deliverable = readAndStrip(path.join(runDir, "deliverable.md"));
  if (deliverable) {
    console.log(`[summary-resolver] Resolved from deliverable.md (${deliverable.length} chars)`);
    return { text: deliverable, source: "deliverable" };
  }

  const statusReport = readAndStrip(path.join(runDir, "status-report.md"));
  if (statusReport) {
    console.log(`[summary-resolver] Resolved from status-report.md (${statusReport.length} chars)`);
    return { text: statusReport, source: "status-report" };
  }

  console.log(`[summary-resolver] No disk artifacts — using fallback (${fallbackWork.length} chars)`);
  return { text: fallbackWork, source: "fallback" };
}

const DB_DISPLAY_LIMIT = 2000;
const DB_TRUNCATION_NOTICE = "\n\n[Full results in job workspace]";

export function resolveJobSummary(
  runDir: string | undefined | null,
  fallbackWork: string,
  maxLength = DB_DISPLAY_LIMIT,
): string {
  const { text } = resolve(runDir, fallbackWork);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + DB_TRUNCATION_NOTICE;
}

const HARD_INPUT_CAP = 100_000;

/**
 * Contract string written by `handler-registry.ts::runDebriefReporter`
 * immediately before each aggregator-written worker wrapper heading. The
 * marker is invisible in rendered markdown and cannot be produced by
 * worker content. Both sides of the contract import THIS constant — do not
 * hard-code the string elsewhere. See the unit test
 * "wrapper-marker contract" which guards against silent divergence.
 */
export const WRAPPER_MARKER = "<!-- wrapper -->";

const WRAPPER_MARKER_RE = new RegExp(
  `${WRAPPER_MARKER.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\n## (.+?)(?:\\n|$)`,
  "g",
);

/**
 * Extract aggregator-written wrapper headings from a multi-section debrief.
 *
 * Contract: `handler-registry.ts::runDebriefReporter` prefixes each wrapper
 * heading with `<!-- wrapper -->\n`. Worker content cannot produce this
 * exact sequence. Worker-internal `## ` headings (`## Diagnosis`,
 * `## Results`, etc.) are NOT prefixed, so they are correctly ignored here
 * and may be compressed/merged by Haiku per the condense prompt.
 *
 * IMPORTANT: the marker string is a contract. Changing either side without
 * the other silently disables the preservation check. See the guard comment
 * at the writer site in handler-registry.ts.
 */
function extractWrapperHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const match of text.matchAll(WRAPPER_MARKER_RE)) {
    headings.push(match[1].trim());
  }
  return headings;
}

/**
 * M9.4-S4.2 Task 10 — strip Haiku conversational preamble.
 *
 * Haiku occasionally narrates the task before producing the condensed output:
 * "I'll help you condense this content...", "Let me start by checking...".
 * These leak into the brief queue and contaminate `[Pending Deliveries]`.
 *
 * Heuristic:
 * 1. Find the first `## ` heading (top-level wrapper boundary).
 * 2. If it sits AFTER content, inspect the leading text for Haiku-style
 *    opener verbs (`I'll`, `Let me`, `Here's`, `Sure`, `First, let me`,
 *    `Now I'll`).
 * 3. If a match is found, slice off everything before the heading. Otherwise
 *    leave the output alone (legitimate intros like "Today's brief:" pass
 *    through untouched).
 *
 * INVARIANT: stripHaikuPreamble may slice off a leading `<!-- wrapper -->`
 * HTML comment if it precedes the first `## heading`. Heading verification
 * uses substring containment (line 165) and is unaffected. If that
 * verification ever tightens to require the marker, this function must
 * preserve it.
 */
function stripHaikuPreamble(text: string): string {
  const firstHeadingIdx = text.search(/^## /m);
  if (firstHeadingIdx === -1) {
    console.log(
      "[summary-resolver] no-heading-passthrough — Haiku output has no `## ` heading; preamble strip skipped",
    );
    return text;
  }
  if (firstHeadingIdx === 0) {
    // Output already starts with the heading — nothing to strip.
    return text;
  }
  const preamble = text.slice(0, firstHeadingIdx);
  if (/^(I'll|Let me|Here's|Sure|Now I'll|First,? let me)/im.test(preamble)) {
    console.log(
      `[summary-resolver] Stripped Haiku preamble (${preamble.length} chars before first ## heading)`,
    );
    return text.slice(firstHeadingIdx);
  }
  return text;
}

export async function resolveJobSummaryAsync(
  runDir: string | undefined | null,
  fallbackWork: string,
  queryModelFn?: (
    prompt: string,
    systemPrompt: string,
    model: "haiku",
  ) => Promise<string>,
): Promise<string> {
  const { text, source } = resolve(runDir, fallbackWork);

  // Under limit — return as-is
  if (text.length <= MAX_LENGTH) return text;

  // Hard cap: >100K chars indicates a runaway worker; skip Haiku, return stub
  if (text.length > HARD_INPUT_CAP) {
    const headings = extractWrapperHeadings(text);
    const sectionList = headings.map((h) => `- ${h}`).join("\n");
    const sizeK = Math.round(text.length / 1000);
    const deliverablePath = runDir ? `${runDir}/deliverable.md` : "(no path)";
    console.warn(
      `[summary-resolver] Hard cap exceeded: ${text.length} chars, ${headings.length} sections — skipping Haiku`,
    );
    return (
      `[Debrief exceeded safe size (${sizeK}K chars across ${headings.length} sections) — content preserved at ${deliverablePath}. Section list:\n` +
      sectionList +
      `]`
    );
  }

  // Over limit but under hard cap — use Haiku to condense without dropping information
  if (queryModelFn) {
    try {
      console.log(`[summary-resolver] Haiku condense: ${text.length} chars → ≤${MAX_LENGTH} (source: ${source})`);
      const expectedHeadings = extractWrapperHeadings(text);
      const rawCondensed = await queryModelFn(
        text,
        CONDENSE_SYSTEM_PROMPT,
        "haiku",
      );
      const condensed = stripHaikuPreamble(rawCondensed);

      // Post-Haiku heading verification: every wrapper heading name must
      // appear SOMEWHERE in the output. Relaxed substring match (not
      // `## <name>`) because Haiku may reformat headings (e.g. bold, emoji,
      // different level) while still preserving the name. Automation names
      // are stable identifiers (e.g. `chiang-mai-aqi-worker`) that Haiku has
      // no reason to rewrite. If the name is missing, the section dropped.
      if (expectedHeadings.length > 0) {
        const missing = expectedHeadings.filter((h) => !condensed.includes(h));
        if (missing.length > 0) {
          console.warn(
            `[summary-resolver] Haiku dropped ${missing.length} section(s): ${missing.join(", ")} — falling back to raw (Haiku output length: ${condensed.length} chars, first 400: ${condensed.slice(0, 400).replace(/\n/g, " ")})`,
          );
          return text;
        }
      }

      return condensed;
    } catch {
      console.warn(`[summary-resolver] Haiku condense failed — returning raw (${text.length} chars)`);
    }
  }

  // Haiku unavailable or failed — return raw content rather than truncate
  return text;
}
