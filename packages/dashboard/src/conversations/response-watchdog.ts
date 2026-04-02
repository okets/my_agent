/**
 * Response Watchdog — Pure Detection Functions
 *
 * Detects three classes of silent brain failure:
 * 1. Garbled response (concatenated monologue, promise without delivery)
 * 2. Missing deliverable (user asked for action, got nothing structured)
 * 3. Tool-heavy silence (many tool calls, minimal user-facing content)
 *
 * All detection is regex/heuristic-based. No LLM calls.
 * Pure functions, no side effects — easy to unit test.
 *
 * @module conversations/response-watchdog
 */

// ── Tuning constants ──────────────────────────────────────────

const GARBLED_CONCAT_THRESHOLD = 3;
const PROMISE_MIN_FOLLOW_CONTENT = 100;
const PROMISE_MIN_FOLLOW_NEWLINES = 3;
const TOOL_HEAVY_THRESHOLD = 8;
const TOOL_HEAVY_MIN_TEXT_AFTER = 100;
const TOOL_HEAVY_SOFT_THRESHOLD = 5;
const TOOL_HEAVY_SOFT_MIN_CONTENT = 50;
const DELIVERABLE_MIN_LENGTH = 500;
const DELIVERABLE_MIN_LIST_ITEMS = 3;

// ── Types ─────────────────────────────────────────────────────

export interface StreamMetadata {
  toolUseCount: number;
  cost?: number;
  /** Characters of text_delta emitted after the most recent tool_use_start */
  textLengthAfterLastTool: number;
}

export interface WatchdogDiagnosis {
  type: "garbled" | "incomplete_deliverable" | "tool_heavy_silence";
  severity: "warning" | "critical";
  description: string;
  recoveryPrompt: string;
}

// ── Detectors ─────────────────────────────────────────────────

/**
 * Detect garbled/concatenated responses.
 *
 * Two signals:
 * 1. Sentence boundaries with no whitespace (monologue fragments glued together)
 * 2. Promise phrase ("here's the plan") with no actual content following it
 */
export function detectGarbledResponse(
  assistantContent: string,
  _metadata: StreamMetadata,
): WatchdogDiagnosis | null {
  if (!assistantContent || assistantContent.length < 30) return null;

  // ── Signal 1: Concatenated monologue ──
  // Pre-filter: strip markdown headings and numbered list lines
  const filteredLines = assistantContent
    .split("\n")
    .filter((line) => !line.match(/^\s*#{1,6}\s/) && !line.match(/^\s*\d+[.)]/))
    .join("\n");

  // Match sentence-ending punctuation immediately followed by uppercase
  // Negative lookbehind excludes URLs (://X) and abbreviations (U.S.A)
  const concatMatches = filteredLines.match(/(?<![A-Z/])[.!?:][A-Z]/g);
  if (concatMatches && concatMatches.length >= GARBLED_CONCAT_THRESHOLD) {
    return {
      type: "garbled",
      severity: "critical",
      description: `concatenated monologue fragments (${concatMatches.length} missing-whitespace boundaries)`,
      recoveryPrompt:
        "Your last response to the user appeared incomplete — it contained concatenated fragments without the actual content. Please review what you were working on and provide the complete response to the user.",
    };
  }

  // ── Signal 2: Promise without delivery ──
  const promisePattern =
    /here(?:'s| is) the plan|let me (?:write|create|design)|writing it now/i;
  const promiseMatch = promisePattern.exec(assistantContent);
  if (promiseMatch) {
    const afterPromise = assistantContent.slice(
      promiseMatch.index + promiseMatch[0].length,
    );
    const newlinesAfter = (afterPromise.match(/\n/g) || []).length;

    if (
      afterPromise.trim().length < PROMISE_MIN_FOLLOW_CONTENT &&
      newlinesAfter < PROMISE_MIN_FOLLOW_NEWLINES
    ) {
      return {
        type: "garbled",
        severity: "critical",
        description:
          "promised a deliverable but response ended without providing it",
        recoveryPrompt:
          "Your last response said you would provide a plan or deliverable, but the response ended without it. Please provide the complete content now.",
      };
    }
  }

  return null;
}

/**
 * Detect responses missing a deliverable the user asked for.
 *
 * Triggers when: user asked for actionable work (not a question),
 * response is short, and has no structured content (lists, code, headings).
 */
export function detectMissingDeliverable(
  userContent: string,
  assistantContent: string,
): WatchdogDiagnosis | null {
  if (!userContent || !assistantContent) return null;

  // Skip if user message is a question
  if (userContent.trim().endsWith("?")) return null;
  if (/^\s*(?:did|can|could|would|have|has|is|are|was)\b/i.test(userContent)) {
    return null;
  }

  // Check if user asked for actionable work
  const actionPattern =
    /(?:set up|configure|help .* with|create|build|implement|add|install|fix|write)\s+.{5,}/i;
  if (!actionPattern.test(userContent)) return null;

  // Response too short?
  if (assistantContent.length >= DELIVERABLE_MIN_LENGTH) return null;

  // Check for structured content
  const listItems = assistantContent.match(/^\s*(?:\d+[.):]\s|[-*]\s)\S/gm);
  if (listItems && listItems.length >= DELIVERABLE_MIN_LIST_ITEMS) return null;
  if (/```/.test(assistantContent)) return null;
  if (/^#{1,3}\s+\S/m.test(assistantContent)) return null;

  // Summarize user request (truncate at word boundary)
  const summary =
    userContent.length > 80
      ? userContent.slice(0, 80).replace(/\s+\S*$/, "") + "..."
      : userContent;

  return {
    type: "incomplete_deliverable",
    severity: "warning",
    description: `user asked for actionable work but response has no structured content (${assistantContent.length} chars, no lists/code/headings)`,
    recoveryPrompt: `You were asked to "${summary}" but your response didn't include the actual deliverable (no steps, code, or structured plan). Please provide it now.`,
  };
}

/**
 * Detect responses where the brain used many tools but produced minimal content.
 */
export function detectToolHeavySilence(
  assistantContent: string,
  metadata: StreamMetadata,
): WatchdogDiagnosis | null {
  const contentLen = assistantContent?.length ?? 0;

  const heavyAndSilent =
    metadata.toolUseCount >= TOOL_HEAVY_THRESHOLD &&
    metadata.textLengthAfterLastTool < TOOL_HEAVY_MIN_TEXT_AFTER;

  const moderateAndEmpty =
    metadata.toolUseCount >= TOOL_HEAVY_SOFT_THRESHOLD &&
    contentLen < TOOL_HEAVY_SOFT_MIN_CONTENT;

  if (!heavyAndSilent && !moderateAndEmpty) return null;

  return {
    type: "tool_heavy_silence",
    severity: "critical",
    description: `used ${metadata.toolUseCount} tools but final response was only ${contentLen} characters (${metadata.textLengthAfterLastTool} chars after last tool)`,
    recoveryPrompt: `You used ${metadata.toolUseCount} tools during your research but your final response to the user was very brief (${contentLen} characters). The user is waiting for a substantive answer based on your research. Please provide it.`,
  };
}

/**
 * Run all detectors in priority order.
 * Returns the first diagnosis found, or null if everything looks fine.
 *
 * Priority: garbled > tool-heavy > missing deliverable
 */
export function runWatchdog(
  userContent: string,
  assistantContent: string,
  metadata: StreamMetadata,
): WatchdogDiagnosis | null {
  return (
    detectGarbledResponse(assistantContent, metadata) ??
    detectToolHeavySilence(assistantContent, metadata) ??
    detectMissingDeliverable(userContent, assistantContent)
  );
}
