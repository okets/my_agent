/**
 * sync.ts — one-way framework-skills → instance-skills sync.
 *
 * Created in M9.6-S21 (BUG-4): `packages/core/skills/capability-brainstorming/SKILL.md`
 * was updated with the terse deliverable contract, but production agents read
 * from `<agentDir>/.claude/skills/capability-brainstorming/SKILL.md` (the copy
 * hatching wrote at setup time). That copy never got updated, so fix agents
 * kept writing verbose 3K deliverables in production.
 *
 * This utility closes the loop: on every app boot, hash-compare every source
 * skill file against its instance-side copy and overwrite when they differ.
 * Missing instance files are created. Instance-only files are left alone — the
 * sync is strictly additive (source → instance), never destructive.
 *
 * Contract:
 *   - Source directory: `packages/core/skills/` (in this repo).
 *   - Target directory: `<agentDir>/.claude/skills/`.
 *   - Hash: SHA-256 over raw file bytes (identical-bytes → no rewrite).
 *   - Returns `{ synced, unchanged }`.
 *
 * Note: if an instance file contains local customizations (extra YAML
 * frontmatter etc.) the sync will overwrite them. That's intentional — the
 * source is canonical and any desired additions belong in the source file.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface SkillsSyncResult {
  /** Files that were either written for the first time or replaced. */
  synced: number;
  /** Files whose source and target hashes matched — no rewrite needed. */
  unchanged: number;
  /** Relative paths (from sourceDir) of files synced this run. Useful for logs. */
  syncedPaths: string[];
}

export interface SyncSkillsOptions {
  /** Absolute path to `packages/core/skills/` (or test equivalent). */
  sourceDir: string;
  /** Absolute path to the instance agent directory. */
  agentDir: string;
  /**
   * Relative target inside `agentDir` — defaults to `.claude/skills`, matching
   * the production read path used by `expandSkillCommand()` and `getSkills()`.
   */
  targetSubdir?: string;
}

const DEFAULT_TARGET_SUBDIR = join(".claude", "skills");

/**
 * Resolve the default path to `packages/core/skills/`. Used by callers that
 * live in the same repo and want the canonical framework-skills directory
 * without re-deriving it.
 */
export function defaultFrameworkSkillsDir(): string {
  // `import.meta.dirname` is the compiled location: packages/core/dist/skills
  // so we walk up to packages/core and into skills/.
  return join(import.meta.dirname, "..", "..", "skills");
}

/**
 * Walk `dir` recursively and yield absolute paths of every file.
 */
async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(full);
      out.push(...nested);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Sync framework skills from `sourceDir` into `<agentDir>/<targetSubdir>`.
 *
 * For each source file:
 *   - if the target file does not exist → create it.
 *   - if the target file exists and SHA-256 bytes match → skip.
 *   - otherwise → overwrite with source content.
 *
 * Returns counts + the set of relative paths that were rewritten.
 */
export async function syncFrameworkSkills(
  options: SyncSkillsOptions,
): Promise<SkillsSyncResult> {
  const { sourceDir, agentDir } = options;
  const targetSubdir = options.targetSubdir ?? DEFAULT_TARGET_SUBDIR;
  const targetRoot = join(agentDir, targetSubdir);

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { synced: 0, unchanged: 0, syncedPaths: [] };
  }

  await mkdir(targetRoot, { recursive: true });

  const sourceFiles = await walk(sourceDir);
  let synced = 0;
  let unchanged = 0;
  const syncedPaths: string[] = [];

  for (const src of sourceFiles) {
    const rel = relative(sourceDir, src);
    const dst = join(targetRoot, rel);

    const srcBytes = await readFile(src);
    const srcHash = sha256(srcBytes);

    let needsWrite = true;
    if (existsSync(dst)) {
      const dstBytes = await readFile(dst);
      const dstHash = sha256(dstBytes);
      if (srcHash === dstHash) {
        needsWrite = false;
      }
    }

    if (!needsWrite) {
      unchanged++;
      continue;
    }

    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, srcBytes);
    synced++;
    syncedPaths.push(rel);
  }

  return { synced, unchanged, syncedPaths };
}

/**
 * Synchronous variant for callers that need to run sync during an
 * already-synchronous boot path. Prefer the async version; this exists only
 * to avoid async-ifying `App.create()` solely for this one call.
 */
export function syncFrameworkSkillsSync(options: SyncSkillsOptions): SkillsSyncResult {
  const { sourceDir, agentDir } = options;
  const targetSubdir = options.targetSubdir ?? DEFAULT_TARGET_SUBDIR;
  const targetRoot = join(agentDir, targetSubdir);

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { synced: 0, unchanged: 0, syncedPaths: [] };
  }

  mkdirSync(targetRoot, { recursive: true });

  function walkSync(dir: string): string[] {
    const res: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) res.push(...walkSync(full));
      else if (entry.isFile()) res.push(full);
    }
    return res;
  }

  const sourceFiles = walkSync(sourceDir);
  let synced = 0;
  let unchanged = 0;
  const syncedPaths: string[] = [];

  for (const src of sourceFiles) {
    const rel = relative(sourceDir, src);
    const dst = join(targetRoot, rel);
    const srcBytes = readFileSync(src);
    const srcHash = sha256(srcBytes);

    let needsWrite = true;
    if (existsSync(dst)) {
      const dstBytes = readFileSync(dst);
      if (sha256(dstBytes) === srcHash) needsWrite = false;
    }

    if (!needsWrite) {
      unchanged++;
      continue;
    }

    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, srcBytes);
    synced++;
    syncedPaths.push(rel);
  }

  return { synced, unchanged, syncedPaths };
}
