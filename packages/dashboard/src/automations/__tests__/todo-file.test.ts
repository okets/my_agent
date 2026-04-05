import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readTodoFile, writeTodoFile, createEmptyTodoFile } from "../todo-file.js";
import type { TodoFile } from "@my-agent/core";

describe("todo-file", () => {
  let tmpDir: string;
  let todoPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-test-"));
    todoPath = path.join(tmpDir, "todos.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createEmptyTodoFile writes valid empty file", () => {
    createEmptyTodoFile(todoPath);
    const data = readTodoFile(todoPath);
    expect(data.items).toEqual([]);
    expect(data.last_activity).toBeDefined();
  });

  it("writeTodoFile uses atomic write (temp + rename)", () => {
    createEmptyTodoFile(todoPath);
    const file: TodoFile = {
      items: [
        {
          id: "t1",
          text: "Test",
          status: "pending",
          mandatory: false,
          created_by: "agent",
        },
      ],
      last_activity: new Date().toISOString(),
    };
    writeTodoFile(todoPath, file);
    // No .tmp file should remain
    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual(["todos.json"]);
    const read = readTodoFile(todoPath);
    expect(read.items).toHaveLength(1);
    expect(read.items[0].text).toBe("Test");
  });

  it("readTodoFile returns empty file for missing path", () => {
    const data = readTodoFile(path.join(tmpDir, "nonexistent.json"));
    expect(data.items).toEqual([]);
  });

  it("writeTodoFile updates last_activity", () => {
    createEmptyTodoFile(todoPath);
    const before = readTodoFile(todoPath).last_activity;
    const file: TodoFile = {
      items: [],
      last_activity: new Date(Date.now() + 1000).toISOString(),
    };
    writeTodoFile(todoPath, file);
    const after = readTodoFile(todoPath).last_activity;
    expect(new Date(after).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });
});
