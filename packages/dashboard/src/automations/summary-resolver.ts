import fs from "node:fs";
import path from "node:path";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const MAX_LENGTH = 10_000;

const CONDENSE_SYSTEM_PROMPT =
  "Condense this content to fit within 10,000 characters. Do NOT drop any information — " +
  "every finding, number, name, date, and actionable item must be preserved. " +
  "Shorten prose, remove filler, use bullets, but keep all substance.";

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

  // Over limit — use Haiku to condense without dropping information
  if (queryModelFn) {
    try {
      console.log(`[summary-resolver] Haiku condense: ${text.length} chars → ≤${MAX_LENGTH} (source: ${source})`);
      return await queryModelFn(
        text.slice(0, 20_000),
        CONDENSE_SYSTEM_PROMPT,
        "haiku",
      );
    } catch {
      console.warn(`[summary-resolver] Haiku condense failed — returning raw (${text.length} chars)`);
    }
  }

  // Haiku unavailable or failed — return raw content rather than truncate
  return text;
}
