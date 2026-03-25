import { readFileSync } from "node:fs";
import { parse } from "yaml";

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
