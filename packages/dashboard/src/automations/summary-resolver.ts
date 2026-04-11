import fs from "node:fs";
import path from "node:path";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const MAX_LENGTH = 4000;
const TRUNCATION_NOTICE =
  "\n\n[Truncated — full content available in job artifacts]";

function readAndStrip(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return null;
    const stripped = raw.replace(FRONTMATTER_RE, "");
    if (!stripped.trim()) return null;
    return stripped;
  } catch {
    return null;
  }
}

function truncate(content: string): string {
  if (content.length <= MAX_LENGTH) return content;
  return content.slice(0, MAX_LENGTH) + TRUNCATION_NOTICE;
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
    return { text: truncate(fallbackWork), source: "fallback" };
  }

  const deliverable = readAndStrip(path.join(runDir, "deliverable.md"));
  if (deliverable) {
    console.log(`[summary-resolver] Resolved from deliverable.md (${deliverable.length} chars)`);
    return { text: truncate(deliverable), source: "deliverable" };
  }

  const statusReport = readAndStrip(path.join(runDir, "status-report.md"));
  if (statusReport) {
    console.log(`[summary-resolver] Resolved from status-report.md (${statusReport.length} chars)`);
    return { text: truncate(statusReport), source: "status-report" };
  }

  console.log(`[summary-resolver] No disk artifacts — using fallback (${fallbackWork.length} chars)`);
  return { text: truncate(fallbackWork), source: "fallback" };
}

export function resolveJobSummary(
  runDir: string | undefined | null,
  fallbackWork: string,
): string {
  return resolve(runDir, fallbackWork).text;
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

  // Disk artifact found — use it, no Haiku needed
  if (source !== "fallback") return text;

  // Fallback is short enough — no summarization needed
  if (fallbackWork.length <= MAX_LENGTH) return text;

  // Try Haiku summarization for long raw streams with no disk artifacts
  if (queryModelFn) {
    try {
      console.log(`[summary-resolver] Haiku fallback for ${fallbackWork.length} char stream`);
      return await queryModelFn(
        fallbackWork.slice(0, 8000),
        "Summarize this work output concisely. Preserve all key findings, numbers, and actionable items. Keep under 3000 characters.",
        "haiku",
      );
    } catch {
      // Haiku failed — fall back to truncation
    }
  }

  return text;
}
