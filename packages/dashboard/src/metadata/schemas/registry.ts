/**
 * Schema Registry
 *
 * Maps file paths (relative to agent dir) to their schema validators.
 * Adding a new schema entry is all that's needed — the validator
 * picks it up automatically.
 */

import { validateWorkPatterns } from "./work-patterns.js";

export interface SchemaEntry {
  /** File path relative to agent dir */
  pathPattern: string;
  /** Validation function: returns array of error strings (empty = valid) */
  validate: (data: unknown) => string[];
}

/**
 * All registered schemas. To add a new one, just add an entry here.
 */
export const SCHEMAS: SchemaEntry[] = [
  {
    pathPattern: "notebook/config/work-patterns.md",
    validate: validateWorkPatterns,
  },
];

/**
 * Get the schema for a given file path (relative to agent dir).
 */
export function getSchemaForPath(
  relativePath: string,
): SchemaEntry | undefined {
  return SCHEMAS.find((s) => s.pathPattern === relativePath);
}
