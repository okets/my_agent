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

export function resolveJobSummary(
  runDir: string | undefined | null,
  fallbackWork: string,
): string {
  if (!runDir) {
    console.log(`[summary-resolver] No runDir — using fallback (${fallbackWork.length} chars)`);
    return truncate(fallbackWork);
  }

  const deliverable = readAndStrip(path.join(runDir, "deliverable.md"));
  if (deliverable) {
    console.log(`[summary-resolver] Resolved from deliverable.md (${deliverable.length} chars)`);
    return truncate(deliverable);
  }

  const statusReport = readAndStrip(path.join(runDir, "status-report.md"));
  if (statusReport) {
    console.log(`[summary-resolver] Resolved from status-report.md (${statusReport.length} chars)`);
    return truncate(statusReport);
  }

  console.log(`[summary-resolver] No disk artifacts — using fallback (${fallbackWork.length} chars)`);
  return truncate(fallbackWork);
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
  // Try disk artifacts first
  const syncResult = resolveJobSummary(runDir, fallbackWork);

  // If disk artifacts were found, return them
  if (syncResult !== truncate(fallbackWork)) return syncResult;

  // If fallback is short enough, no need for Haiku
  if (fallbackWork.length <= MAX_LENGTH) return syncResult;

  // Try Haiku summarization
  if (queryModelFn) {
    try {
      return await queryModelFn(
        fallbackWork.slice(0, 8000),
        "Summarize this work output concisely. Preserve all key findings, numbers, and actionable items. Keep under 3000 characters.",
        "haiku",
      );
    } catch {
      // Haiku failed — fall back to truncation
    }
  }

  return syncResult;
}
