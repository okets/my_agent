/**
 * Utility functions for extracting and validating deliverables from brain responses.
 * Moved from tasks/task-executor.ts during old task system removal.
 */

/**
 * Extract deliverable content from brain response
 */
export function extractDeliverable(response: string): {
  work: string;
  deliverable: string | null;
} {
  const match = response.match(/<deliverable>([\s\S]*?)<\/deliverable>/);
  if (match) {
    const deliverable = match[1].trim();
    const work = response.replace(match[0], "").trim();
    return { work, deliverable: deliverable || null };
  }
  return { work: response, deliverable: null };
}

/**
 * Validate that the deliverable is suitable for delivery
 */
export function validateDeliverable(
  deliverable: string | null,
  hasDeliveryActions: boolean,
): { valid: boolean; reason?: string } {
  if (!hasDeliveryActions) return { valid: true };
  if (deliverable === null)
    return { valid: false, reason: "Deliverable tags missing from response" };
  if (deliverable.trim() === "")
    return { valid: false, reason: "Deliverable is empty" };
  if (deliverable.trim().toUpperCase() === "NONE")
    return {
      valid: false,
      reason: "Brain declined to produce deliverable",
    };
  return { valid: true };
}
