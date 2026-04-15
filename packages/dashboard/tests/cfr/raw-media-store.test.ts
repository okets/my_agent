/**
 * RawMediaStore — acceptance tests (M9.6-S1)
 *
 * Verifies: save + read-back idempotence, MIME→extension mapping exhaustive.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RawMediaStore } from "../../src/media/raw-media-store.js";

describe("RawMediaStore", () => {
  let agentDir: string;
  let store: RawMediaStore;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "rms-test-"));
    store = new RawMediaStore(agentDir);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ── save + exists + idempotence ─────────────────────────────────

  it("saves a buffer and returns an absolute path", async () => {
    const buf = Buffer.from("hello audio");
    const path = await store.save("conv-001", "msg-001", "audio/ogg", buf);
    expect(path).toContain(agentDir);
    expect(path).toContain("conv-001");
    expect(path).toContain("msg-001");
    expect(path.endsWith(".ogg")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path)).toEqual(buf);
  });

  it("is idempotent — second save returns same path without overwrite", async () => {
    const buf1 = Buffer.from("first write");
    const buf2 = Buffer.from("second write");
    const path1 = await store.save("conv-001", "msg-001", "audio/ogg", buf1);
    const path2 = await store.save("conv-001", "msg-001", "audio/ogg", buf2);
    expect(path1).toBe(path2);
    // File should still contain original content
    expect(readFileSync(path1).toString()).toBe("first write");
  });

  it("exists() returns true for saved file", async () => {
    const buf = Buffer.from("data");
    const path = await store.save("conv-001", "msg-001", "audio/ogg", buf);
    expect(store.exists(path)).toBe(true);
  });

  it("exists() returns false for unsaved path", () => {
    const path = store.pathFor("conv-999", "msg-999", "audio/ogg");
    expect(store.exists(path)).toBe(false);
  });

  it("exists() returns false for empty file", async () => {
    const emptyBuf = Buffer.alloc(0);
    const path = store.pathFor("conv-001", "empty-001", "audio/ogg");
    // Write an empty file manually to test
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, emptyBuf);
    expect(store.exists(path)).toBe(false);
  });

  it("pathFor() returns deterministic path without creating file", () => {
    const path = store.pathFor("conv-001", "msg-abc", "audio/ogg");
    expect(existsSync(path)).toBe(false);
    expect(path).toBe(
      join(agentDir, "conversations", "conv-001", "raw", "msg-abc.ogg"),
    );
  });

  // ── MIME → extension mapping ────────────────────────────────────

  const mimeExtCases: Array<[string, string]> = [
    ["audio/ogg", ".ogg"],
    ["audio/mpeg", ".mp3"],
    ["audio/wav", ".wav"],
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/webp", ".webp"],
    ["image/gif", ".gif"],
    ["application/pdf", ".pdf"],
    ["application/octet-stream", ".octet-stream"],
    ["video/mp4", ".mp4"],
  ];

  for (const [mime, ext] of mimeExtCases) {
    it(`maps ${mime} → ${ext}`, () => {
      const path = store.pathFor("conv-001", "att-001", mime);
      expect(path.endsWith(ext)).toBe(true);
    });
  }

  it("falls back to .bin for malformed MIME (no slash)", () => {
    const path = store.pathFor("conv-001", "att-001", "invalidmime");
    expect(path.endsWith(".bin")).toBe(true);
  });
});
