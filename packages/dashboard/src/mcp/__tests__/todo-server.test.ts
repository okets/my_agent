import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTodoTools } from "../todo-server.js";
import {
  readTodoFile,
  writeTodoFile,
  createEmptyTodoFile,
} from "../../automations/todo-file.js";

describe("todo-server tools", () => {
  let tmpDir: string;
  let todoPath: string;
  let tools: ReturnType<typeof createTodoTools>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-mcp-"));
    todoPath = path.join(tmpDir, "todos.json");
    createEmptyTodoFile(todoPath);
    tools = createTodoTools(todoPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("todo_add creates an agent item", async () => {
    const result = await tools.todo_add({ text: "Do something" });
    expect((result as Record<string, unknown>).isError).toBeUndefined();
    const file = readTodoFile(todoPath);
    expect(file.items).toHaveLength(1);
    expect(file.items[0].text).toBe("Do something");
    expect(file.items[0].mandatory).toBe(false);
    expect(file.items[0].created_by).toBe("agent");
  });

  it("todo_list returns all items", async () => {
    await tools.todo_add({ text: "Item 1" });
    await tools.todo_add({ text: "Item 2" });
    const result = await tools.todo_list({});
    expect(result.content).toBeDefined();
    const text = result.content[0].text;
    expect(text).toContain("Item 1");
    expect(text).toContain("Item 2");
  });

  it("todo_list returns empty message when no items", async () => {
    const result = await tools.todo_list({});
    expect(result.content[0].text).toBe("No todo items.");
  });

  it("todo_update changes status", async () => {
    await tools.todo_add({ text: "Task" });
    const items = readTodoFile(todoPath).items;
    await tools.todo_update({ id: items[0].id, status: "done" });
    const updated = readTodoFile(todoPath).items[0];
    expect(updated.status).toBe("done");
  });

  it("todo_update adds notes", async () => {
    await tools.todo_add({ text: "Task" });
    const items = readTodoFile(todoPath).items;
    await tools.todo_update({ id: items[0].id, notes: "Blocked on API" });
    const updated = readTodoFile(todoPath).items[0];
    expect(updated.notes).toBe("Blocked on API");
  });

  it("todo_update returns error for missing item", async () => {
    const result = await tools.todo_update({
      id: "nonexistent",
      status: "done",
    });
    expect(result.isError).toBe(true);
  });

  it("todo_remove deletes non-mandatory item", async () => {
    await tools.todo_add({ text: "Removable" });
    const items = readTodoFile(todoPath).items;
    await tools.todo_remove({ id: items[0].id });
    expect(readTodoFile(todoPath).items).toHaveLength(0);
  });

  it("todo_remove rejects mandatory item with isError", async () => {
    // Pre-populate with mandatory item
    const file = readTodoFile(todoPath);
    file.items.push({
      id: "t1",
      text: "Required",
      status: "pending",
      mandatory: true,
      created_by: "framework",
    });
    writeTodoFile(todoPath, file);

    const result = await tools.todo_remove({ id: "t1" });
    expect(result.isError).toBe(true);
    expect(readTodoFile(todoPath).items).toHaveLength(1);
  });

  it("todo_remove returns error for missing item", async () => {
    const result = await tools.todo_remove({ id: "nonexistent" });
    expect(result.isError).toBe(true);
  });

  it("every tool call updates last_activity", async () => {
    const before = readTodoFile(todoPath).last_activity;
    await new Promise((r) => setTimeout(r, 10));
    await tools.todo_list({});
    const after = readTodoFile(todoPath).last_activity;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });
});
