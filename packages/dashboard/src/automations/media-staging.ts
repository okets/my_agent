/**
 * Media Staging — Temporary storage for incoming channel media
 *
 * Stages files to `.my_agent/staging/` with unique names.
 * Cleanup removes files older than maxAge (default: 24h).
 */

import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Ensure the staging directory exists.
 */
export async function ensureStagingDir(agentDir: string): Promise<string> {
  const dir = join(agentDir, "staging");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate a staging path for an incoming media file.
 * Returns the full path where the file should be saved.
 */
export function stagingPath(agentDir: string, originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "bin";
  const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  return join(agentDir, "staging", uniqueName);
}

/**
 * Clean up staging files older than maxAgeMs (default: 24h).
 */
export async function cleanStaging(agentDir: string, maxAgeMs = 86_400_000): Promise<number> {
  const dir = join(agentDir, "staging");
  let cleaned = 0;

  try {
    const files = await readdir(dir);
    const now = Date.now();

    for (const file of files) {
      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > maxAgeMs) {
        await unlink(filePath);
        cleaned++;
      }
    }
  } catch {
    // staging dir may not exist yet
  }

  return cleaned;
}
