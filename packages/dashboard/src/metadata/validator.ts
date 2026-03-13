/**
 * Metadata Validator (spec §4)
 *
 * Validates YAML frontmatter in markdown files against registered schemas.
 * Creates notifications on error with a "Fix" button.
 * Haiku repair on user tap — max 1 attempt per error.
 */

import { readFrontmatter, writeFrontmatter } from "./frontmatter.js";
import { getSchemaForPath } from "./schemas/registry.js";
import { relative } from "node:path";

export interface ValidationError {
  file: string;
  errors: string[];
}

/**
 * Validate a frontmatter file against its registered schema.
 *
 * @param filePath - Absolute path to the markdown file
 * @param agentDir - Agent directory (for resolving relative path to schema)
 * @returns Array of validation errors (empty = valid)
 */
export function validateFrontmatter(
  filePath: string,
  agentDir: string,
): ValidationError[] {
  const relativePath = relative(agentDir, filePath);
  const schema = getSchemaForPath(relativePath);

  if (!schema) {
    // No schema registered for this file — nothing to validate
    return [];
  }

  try {
    const { data } = readFrontmatter(filePath);
    const errors = schema.validate(data);

    if (errors.length > 0) {
      return [{ file: relativePath, errors }];
    }

    return [];
  } catch (err) {
    return [
      {
        file: relativePath,
        errors: [
          `Failed to parse frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
    ];
  }
}

/**
 * Hook validation into the scheduler's reloadPatterns flow.
 *
 * Call this after reloadPatterns() to validate and create notifications.
 *
 * @param filePath - Absolute path to the file that changed
 * @param agentDir - Agent directory
 * @param notificationService - Optional notification service (if available)
 * @returns Validation errors found
 */
export function validateAndNotify(
  filePath: string,
  agentDir: string,
  notificationService?: {
    requestInput: (input: {
      question: string;
      options: string[] | Array<{ label: string; value: string }>;
    }) => { id: string };
    notify: (input: {
      message: string;
      importance?: "info" | "warning" | "success" | "error";
    }) => void;
  },
): ValidationError[] {
  const errors = validateFrontmatter(filePath, agentDir);

  if (errors.length > 0 && notificationService) {
    const errorSummary = errors
      .flatMap((e) => e.errors.map((err) => `${e.file}: ${err}`))
      .join("; ");

    notificationService.requestInput({
      question: `Metadata validation error: ${errorSummary}`,
      options: [
        { label: "Fix", value: "fix" },
        { label: "Dismiss", value: "dismiss" },
      ],
    });
  }

  return errors;
}

/**
 * Attempt haiku-powered repair of broken frontmatter.
 *
 * @param filePath - Absolute path to the broken file
 * @param agentDir - Agent directory
 * @param errors - The validation errors to fix
 * @param queryHaiku - Function that sends a prompt to haiku and returns the response
 * @param notificationService - For reporting repair success/failure
 * @returns true if repair succeeded, false otherwise
 */
export async function attemptHaikuRepair(
  filePath: string,
  agentDir: string,
  errors: ValidationError[],
  queryHaiku: (system: string, user: string) => Promise<string>,
  notificationService?: {
    notify: (input: {
      message: string;
      importance?: "info" | "warning" | "success" | "error";
    }) => void;
  },
): Promise<boolean> {
  const relativePath = relative(agentDir, filePath);
  const schema = getSchemaForPath(relativePath);
  if (!schema) return false;

  try {
    const { data, body } = readFrontmatter(filePath);
    const brokenYaml = JSON.stringify(data, null, 2);
    const errorDesc = errors.flatMap((e) => e.errors).join("\n");

    const system = `You are a YAML repair assistant. Fix the broken YAML frontmatter data. Return ONLY valid JSON that can be parsed with JSON.parse(). No markdown fences, no explanation.`;
    const user = `The following frontmatter data has validation errors:

DATA:
${brokenYaml}

ERRORS:
${errorDesc}

Fix the data so it passes validation. Return corrected JSON only.`;

    const response = await queryHaiku(system, user);

    // Parse haiku's response as JSON
    let repaired: Record<string, unknown>;
    try {
      repaired = JSON.parse(response.trim());
    } catch {
      // Try to extract JSON from response (haiku might wrap in markdown)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Haiku response is not valid JSON");
      }
      repaired = JSON.parse(jsonMatch[0]);
    }

    // Validate the repair before writing
    const repairErrors = schema.validate(repaired);
    if (repairErrors.length > 0) {
      notificationService?.notify({
        message: `Auto-repair failed for ${relativePath}. Manual edit needed.`,
        importance: "warning",
      });
      return false;
    }

    // Write the repaired data
    writeFrontmatter(filePath, repaired, body);

    return true;
  } catch (err) {
    notificationService?.notify({
      message: `Auto-repair failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}. Manual edit needed.`,
      importance: "warning",
    });
    return false;
  }
}
