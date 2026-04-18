import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readLastAuditTimestamp } from "../audit-liveness.js";

describe("readLastAuditTimestamp", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-liveness-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when audit log does not exist", () => {
    const result = readLastAuditTimestamp(tmpDir, "session-x");
    expect(result).toBe(0);
  });

  it("returns 0 when no entries match the session", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    fs.writeFileSync(
      path.join(tmpDir, "logs", "audit.jsonl"),
      JSON.stringify({ timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "other-session" }) + "\n",
    );
    const result = readLastAuditTimestamp(tmpDir, "target-session");
    expect(result).toBe(0);
  });

  it("returns the most recent timestamp for a matching session", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    const lines = [
      { timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "target" },
      { timestamp: "2026-04-18T00:01:00.000Z", tool: "Bash", session: "other" },
      { timestamp: "2026-04-18T00:02:00.000Z", tool: "WebFetch", session: "target" },
      { timestamp: "2026-04-18T00:03:00.000Z", tool: "Edit", session: "other" },
    ].map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(path.join(tmpDir, "logs", "audit.jsonl"), lines + "\n");

    const result = readLastAuditTimestamp(tmpDir, "target");
    expect(result).toBe(new Date("2026-04-18T00:02:00.000Z").getTime());
  });

  it("only scans the tail of large audit logs (bounded cost)", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    const lines: string[] = [];
    for (let i = 0; i < 4990; i++) {
      lines.push(JSON.stringify({ timestamp: `2026-04-18T00:00:${String(i % 60).padStart(2, "0")}.000Z`, tool: "Read", session: "noise" }));
    }
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ timestamp: `2026-04-18T01:00:${String(i).padStart(2, "0")}.000Z`, tool: "Bash", session: "target" }));
    }
    fs.writeFileSync(path.join(tmpDir, "logs", "audit.jsonl"), lines.join("\n") + "\n");

    const result = readLastAuditTimestamp(tmpDir, "target");
    expect(result).toBe(new Date("2026-04-18T01:00:09.000Z").getTime());
  });

  it("returns 0 if the matching session entries are older than the tail window", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    const lines: string[] = [];
    lines.push(JSON.stringify({ timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "target" }));
    for (let i = 0; i < 1000; i++) {
      lines.push(JSON.stringify({ timestamp: "2026-04-18T01:00:00.000Z", tool: "Read", session: "noise", padding: "x".repeat(100) }));
    }
    fs.writeFileSync(path.join(tmpDir, "logs", "audit.jsonl"), lines.join("\n") + "\n");

    const result = readLastAuditTimestamp(tmpDir, "target");
    expect(result).toBe(0);
  });

  it("returns 0 when sessionId is empty/undefined (handle missing sdk_session_id gracefully)", () => {
    fs.mkdirSync(path.join(tmpDir, "logs"));
    fs.writeFileSync(
      path.join(tmpDir, "logs", "audit.jsonl"),
      JSON.stringify({ timestamp: "2026-04-18T00:00:00.000Z", tool: "Read", session: "x" }) + "\n",
    );
    expect(readLastAuditTimestamp(tmpDir, "")).toBe(0);
  });
});
