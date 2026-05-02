import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTodoTools, type ValidatorFn } from "../todo-server.js";
import {
  readTodoFile,
  writeTodoFile,
  createEmptyTodoFile,
} from "../../automations/todo-file.js";
import { runValidation } from "../../automations/todo-validators.js";

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

describe("todo-server validation", () => {
  let tmpDir: string;
  let todoPath: string;
  let tools: ReturnType<typeof createTodoTools>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-val-"));
    todoPath = path.join(tmpDir, "todos.json");
    createEmptyTodoFile(todoPath);
    tools = createTodoTools(todoPath, runValidation);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("todo_update with validation rejects when validator fails", async () => {
    // Pre-populate with mandatory item that has a validator
    const file = readTodoFile(todoPath);
    file.items.push({
      id: "t1",
      text: "Fill completion report",
      status: "in_progress",
      mandatory: true,
      validation: "completion_report",
      created_by: "framework",
    });
    writeTodoFile(todoPath, file);

    // No deliverable.md exists, so validator should fail
    const result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("deliverable.md");
    // Item should still be in_progress
    expect(readTodoFile(todoPath).items[0].status).toBe("in_progress");
    // validation_attempts should be 1
    expect(readTodoFile(todoPath).items[0].validation_attempts).toBe(1);
  });

  it("todo_update auto-blocks after 3 failed validations", async () => {
    const file = readTodoFile(todoPath);
    file.items.push({
      id: "t1",
      text: "Fill report",
      status: "in_progress",
      mandatory: true,
      validation: "completion_report",
      created_by: "framework",
      validation_attempts: 2, // Already failed twice
    });
    writeTodoFile(todoPath, file);

    const result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBe(true);
    // Should be auto-blocked now
    const item = readTodoFile(todoPath).items[0];
    expect(item.status).toBe("blocked");
    expect(item.validation_attempts).toBe(3);
  });

  it("todo_update passes validation when deliverable is valid", async () => {
    // M9.4-S4.3: completion_report reads from result.json sidecar
    fs.writeFileSync(path.join(tmpDir, "deliverable.md"), "Done.\n");
    fs.writeFileSync(
      path.join(tmpDir, "result.json"),
      JSON.stringify({ change_type: "configure" }),
    );

    const file = readTodoFile(todoPath);
    file.items.push({
      id: "t1",
      text: "Fill completion report",
      status: "in_progress",
      mandatory: true,
      validation: "completion_report",
      created_by: "framework",
    });
    writeTodoFile(todoPath, file);

    const result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBeUndefined();
    expect(readTodoFile(todoPath).items[0].status).toBe("done");
  });

  it("non-mandatory items skip validation", async () => {
    const file = readTodoFile(todoPath);
    file.items.push({
      id: "t1",
      text: "Optional task",
      status: "in_progress",
      mandatory: false,
      validation: "completion_report",
      created_by: "agent",
    });
    writeTodoFile(todoPath, file);

    // No deliverable.md — but should pass because not mandatory
    const result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBeUndefined();
    expect(readTodoFile(todoPath).items[0].status).toBe("done");
  });

  it("items without validation skip validation check", async () => {
    const file = readTodoFile(todoPath);
    file.items.push({
      id: "t1",
      text: "No validator",
      status: "in_progress",
      mandatory: true,
      created_by: "delegator",
    });
    writeTodoFile(todoPath, file);

    const result = await tools.todo_update({ id: "t1", status: "done" });
    expect(result.isError).toBeUndefined();
    expect(readTodoFile(todoPath).items[0].status).toBe("done");
  });
});
