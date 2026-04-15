/**
 * RawMediaStore — persists inbound media buffers to disk before any downstream processing.
 * Created in M9.6-S1.
 */

import { mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

/** Map a MIME type to a file extension. */
function mimeToExt(mimeType: string): string {
  switch (mimeType) {
    case "audio/ogg":
      return ".ogg";
    case "audio/mpeg":
      return ".mp3";
    case "audio/wav":
      return ".wav";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    default: {
      // Use the second part of the mime type (e.g. "image/webp" → ".webp")
      const sub = mimeType.split("/")[1];
      if (sub) return `.${sub}`;
      return ".bin";
    }
  }
}

export class RawMediaStore {
  constructor(private agentDir: string) {}

  /**
   * Persist an inbound media buffer. Returns absolute path.
   * Writes to: <agentDir>/conversations/<conversationId>/raw/<attachmentId>.<ext>
   * Creates directories as needed. Idempotent per attachmentId.
   */
  async save(
    conversationId: string,
    attachmentId: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<string> {
    const absPath = this.pathFor(conversationId, attachmentId, mimeType);
    if (this.exists(absPath)) {
      return absPath;
    }
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, buffer);
    return absPath;
  }

  /** Absolute path for a persisted artifact, whether or not it exists on disk. */
  pathFor(
    conversationId: string,
    attachmentId: string,
    mimeType: string,
  ): string {
    const ext = mimeToExt(mimeType);
    return join(
      this.agentDir,
      "conversations",
      conversationId,
      "raw",
      `${attachmentId}${ext}`,
    );
  }

  /** Returns true if the path exists and is non-empty. */
  exists(absolutePath: string): boolean {
    try {
      return existsSync(absolutePath) && statSync(absolutePath).size > 0;
    } catch {
      return false;
    }
  }
}
