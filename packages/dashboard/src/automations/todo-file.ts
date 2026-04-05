import fs from "node:fs";
import path from "node:path";
import type { TodoFile } from "@my-agent/core";

export function createEmptyTodoFile(filePath: string): void {
  const data: TodoFile = {
    items: [],
    last_activity: new Date().toISOString(),
  };
  writeTodoFile(filePath, data);
}

export function readTodoFile(filePath: string): TodoFile {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as TodoFile;
  } catch {
    return { items: [], last_activity: new Date().toISOString() };
  }
}

export function writeTodoFile(filePath: string, data: TodoFile): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export function touchActivity(filePath: string): void {
  const data = readTodoFile(filePath);
  data.last_activity = new Date().toISOString();
  writeTodoFile(filePath, data);
}
