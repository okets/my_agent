import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Use this for content already in memory (e.g., from FileWatcher).
 */
export function parseFrontmatterContent<T = Record<string, unknown>>(
  content: string,
): FrontmatterResult<T> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { data: {} as T, body: content };
  }
  const closingIndex = content.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return { data: {} as T, body: content };
  }
  const yamlStr = content.slice(4, closingIndex);
  let body = content.slice(closingIndex + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  const data = (parse(yamlStr) as T) ?? ({} as T);
  return { data, body };
}

/**
 * Read and parse YAML frontmatter from a markdown file on disk.
 */
export function readFrontmatter<T = Record<string, unknown>>(
  filePath: string,
): FrontmatterResult<T> {
  const content = readFileSync(filePath, "utf-8");
  return parseFrontmatterContent<T>(content);
}

/**
 * Write YAML frontmatter + markdown body to a file.
 *
 * Mirrors `packages/dashboard/src/metadata/frontmatter.ts:writeFrontmatter` — kept
 * identical shape so either layer can round-trip via the same convention.
 *
 * If body is omitted and the file already exists, the existing body is preserved.
 */
export function writeFrontmatter(
  filePath: string,
  data: Record<string, unknown>,
  body?: string,
): void {
  let finalBody = body ?? "";

  if (body === undefined) {
    try {
      const existing = readFrontmatter(filePath);
      finalBody = existing.body;
    } catch {
      // File doesn't exist yet — empty body is fine.
    }
  }

  const yamlStr = stringify(data, { lineWidth: 120 });
  const content = `---\n${yamlStr}---\n${finalBody ? `\n${finalBody}` : ""}`;
  writeFileSync(filePath, content, "utf-8");
}
