import type { ScreenshotTag } from "@my-agent/core";

export const DIFF_THRESHOLD = 0.15;

/**
 * Compare two raw buffers byte-by-byte.
 * Returns the fraction of bytes that differ (0.0 to 1.0).
 * Uses Math.min(a.length, b.length) as the comparison length.
 */
export function computeDiffRatio(a: Buffer, b: Buffer): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let diffCount = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diffCount++;
  }

  return diffCount / len;
}

/**
 * Determine the tag for an untagged screenshot by comparing it to the previous one.
 * - If previous is null (first screenshot) → "keep"
 * - If diff ratio >= DIFF_THRESHOLD → "keep"
 * - Otherwise → "skip"
 */
export function tagByDiff(current: Buffer, previous: Buffer | null): ScreenshotTag {
  if (previous === null) return "keep";

  const ratio = computeDiffRatio(current, previous);
  return ratio >= DIFF_THRESHOLD ? "keep" : "skip";
}
