import { describe, it, expect, afterAll } from "vitest";
import { TaskLogStorage } from "../../src/tasks/log-storage.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("TaskLogStorage — new directory structure", () => {
  const tmpDir = path.join(os.tmpdir(), `log-storage-test-${Date.now()}`);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates task directory with workspace subdirectory", () => {
    const storage = new TaskLogStorage(tmpDir);
    storage.createLog("task-001", "session-abc", "Test Task");

    expect(fs.existsSync(path.join(tmpDir, "tasks/task-001/task.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "tasks/task-001/workspace"))).toBe(true);
  });

  it("getLogPath returns new path for new tasks", () => {
    const storage = new TaskLogStorage(tmpDir);
    // task-001 was created above, so new path exists
    const logPath = storage.getLogPath("task-001");
    expect(logPath).toContain("tasks/task-001/task.jsonl");
  });

  it("getLogPath returns new path for unknown tasks (default)", () => {
    const storage = new TaskLogStorage(tmpDir);
    const logPath = storage.getLogPath("nonexistent-task");
    expect(logPath).toContain("tasks/nonexistent-task/task.jsonl");
  });

  it("reads old log path if new path doesn't exist", () => {
    const storage = new TaskLogStorage(tmpDir);
    // Create a log at the old location
    const oldDir = path.join(tmpDir, "tasks/logs");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "old-task.jsonl"), '{"type":"meta"}\n');

    const logPath = storage.getLogPath("old-task");
    expect(logPath).toContain("tasks/logs/old-task.jsonl");
  });

  it("getTaskDir returns task directory path", () => {
    const storage = new TaskLogStorage(tmpDir);
    const taskDir = storage.getTaskDir("task-003");
    expect(taskDir).toBe(path.join(tmpDir, "tasks/task-003"));
  });

  it("log file contains valid metadata", () => {
    const storage = new TaskLogStorage(tmpDir);
    storage.createLog("task-meta-test", "session-xyz", "Meta Test");
    const logPath = storage.getLogPath("task-meta-test");
    const content = fs.readFileSync(logPath, "utf-8").trim();
    const meta = JSON.parse(content);
    expect(meta.type).toBe("meta");
    expect(meta.taskId).toBe("task-meta-test");
    expect(meta.sessionId).toBe("session-xyz");
    expect(meta.title).toBe("Meta Test");
  });
});
