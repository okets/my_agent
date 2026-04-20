import fs from "node:fs";
import path from "node:path";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const MAX_LENGTH = 10_000;

const CONDENSE_SYSTEM_PROMPT =
  "Condense this content to fit within 10,000 characters. Do NOT drop any information — " +
  "every finding, number, name, date, and actionable item must be preserved. " +
  "If the content has `## ` section headings written at the top level (aggregator-style " +
  "worker wrappers), every such heading MUST appear in the output in its original order. " +
  "You may compress the body under each heading and merge internal subsections, but never " +
  "drop a top-level section entirely. Shorten prose, remove filler, use bullets, but keep all substance.";

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

/** Extract all top-level `## heading` lines from text. */
function extractTopLevelHeadings(text: string): string[] {
  return (text.match(/^## \S.*/gm) ?? []).map((h) => h.slice(3).trim());
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
    const headings = extractTopLevelHeadings(text);
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
      const expectedHeadings = extractTopLevelHeadings(text);
      const condensed = await queryModelFn(
        text,
        CONDENSE_SYSTEM_PROMPT,
        "haiku",
      );

      // Post-Haiku heading verification: every top-level heading must survive
      if (expectedHeadings.length > 0) {
        const missing = expectedHeadings.filter(
          (h) => !condensed.includes(`## ${h}`),
        );
        if (missing.length > 0) {
          console.warn(
            `[summary-resolver] Haiku dropped ${missing.length} section(s): ${missing.join(", ")} — falling back to raw`,
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
