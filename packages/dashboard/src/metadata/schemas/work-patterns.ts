/**
 * Schema definition for work-patterns.md frontmatter.
 *
 * Expected structure:
 * ```yaml
 * jobs:
 *   debrief-prep:
 *     cadence: "daily:08:00"
 *     model: haiku
 *   daily-summary:
 *     cadence: "daily:23:00"
 *     model: haiku
 * ```
 */

const VALID_CADENCE =
  /^(daily:\d{2}:\d{2}|weekly:(sunday|monday|tuesday|wednesday|thursday|friday|saturday):\d{2}:\d{2})$/;
const KNOWN_MODELS = ["haiku", "sonnet", "opus"];

/**
 * Validate work-patterns.md frontmatter data.
 * @returns Array of error strings (empty = valid)
 */
export function validateWorkPatterns(data: unknown): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Frontmatter must be an object");
    return errors;
  }

  const obj = data as Record<string, unknown>;

  if (!obj.jobs) {
    errors.push("Missing required 'jobs' key");
    return errors;
  }

  if (
    typeof obj.jobs !== "object" ||
    obj.jobs === null ||
    Array.isArray(obj.jobs)
  ) {
    errors.push("'jobs' must be an object mapping job names to configurations");
    return errors;
  }

  const jobs = obj.jobs as Record<string, unknown>;

  for (const [jobName, jobConfig] of Object.entries(jobs)) {
    if (!jobConfig || typeof jobConfig !== "object") {
      errors.push(
        `Job '${jobName}': must be an object with cadence and optional model`,
      );
      continue;
    }

    const job = jobConfig as Record<string, unknown>;

    if (!job.cadence || typeof job.cadence !== "string") {
      errors.push(`Job '${jobName}': missing required 'cadence' field`);
      continue;
    }

    if (!VALID_CADENCE.test(job.cadence)) {
      errors.push(
        `Job '${jobName}': invalid cadence format '${job.cadence}'. Expected 'daily:HH:MM' or 'weekly:DAYNAME:HH:MM'`,
      );
    }

    if (job.model !== undefined) {
      if (typeof job.model !== "string" || !KNOWN_MODELS.includes(job.model)) {
        errors.push(
          `Job '${jobName}': unknown model '${job.model}'. Valid: ${KNOWN_MODELS.join(", ")}`,
        );
      }
    }
  }

  return errors;
}
