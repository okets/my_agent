/**
 * Debug module — pure functions for headless agent access to debug data.
 *
 * Re-exports all functions and types from debug-queries.ts.
 * M6.10-S4: Headless App extraction.
 */

export {
  getBrainStatus,
  getBrainFiles,
  getSkills,
  getSystemPrompt,
} from "./debug-queries.js";

export type {
  BrainStatus,
  FileEntry,
  BrainFiles,
  SkillEntry,
  SkillInventory,
  ComponentInfo,
  SystemPromptResult,
} from "./debug-queries.js";

export { AppDebugService } from "./app-debug-service.js";
