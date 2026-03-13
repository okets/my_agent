/**
 * Generic YAML frontmatter read/write utilities.
 *
 * These are the ONLY way to read or write structured metadata
 * in markdown files. No regex parsing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

export interface FrontmatterResult<T = Record<string, unknown>> {
  /** Parsed YAML data from frontmatter */
  data: T;
  /** Markdown body after the closing --- fence */
  body: string;
}

/**
 * Read and parse YAML frontmatter from a markdown file.
 *
 * @param filePath - Absolute path to the markdown file
 * @returns Parsed data and remaining body text
 * @throws If the file doesn't exist or YAML is malformed
 */
export function readFrontmatter<T = Record<string, unknown>>(
  filePath: string,
): FrontmatterResult<T> {
  const content = readFileSync(filePath, "utf-8");

  // No frontmatter
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { data: {} as T, body: content };
  }

  // Find closing fence
  const closingIndex = content.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return { data: {} as T, body: content };
  }

  const yamlStr = content.slice(4, closingIndex);
  const body = content.slice(closingIndex + 4); // Skip past "\n---"

  const data = parse(yamlStr) as T;

  // Handle YAML that parses to null (empty frontmatter)
  return {
    data: data ?? ({} as T),
    body: body.startsWith("\n") ? body.slice(1) : body,
  };
}

/**
 * Write YAML frontmatter + markdown body to a file.
 *
 * If body is omitted and the file already exists, the existing body is preserved.
 *
 * @param filePath - Absolute path to the markdown file
 * @param data - Object to serialize as YAML frontmatter
 * @param body - Optional markdown body (if omitted, preserves existing body)
 */
export function writeFrontmatter(
  filePath: string,
  data: Record<string, unknown>,
  body?: string,
): void {
  let finalBody = body ?? "";

  // If body not provided, try to preserve existing body
  if (body === undefined) {
    try {
      const existing = readFrontmatter(filePath);
      finalBody = existing.body;
    } catch {
      // File doesn't exist yet, empty body is fine
    }
  }

  const yamlStr = stringify(data, { lineWidth: 120 });
  const content = `---\n${yamlStr}---\n${finalBody ? `\n${finalBody}` : ""}`;
  writeFileSync(filePath, content, "utf-8");
}
