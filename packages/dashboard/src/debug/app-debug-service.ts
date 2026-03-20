/**
 * AppDebugService — ergonomic wrapper around debug-queries pure functions.
 *
 * Mounted as `app.debug` on the App class and AppHarness.
 * Agents and tests call `app.debug.brainStatus()` instead of importing
 * pure functions and threading agentDir manually.
 *
 * M6.10-S4: Headless App extraction.
 */

import {
  getBrainStatus,
  getBrainFiles,
  getSkills,
  getSystemPrompt,
  type BrainStatus,
  type BrainFiles,
  type SkillInventory,
  type SystemPromptResult,
} from "./debug-queries.js";

export class AppDebugService {
  constructor(
    private agentDir: string,
    private frameworkSkillsDir?: string,
  ) {}

  async brainStatus(): Promise<BrainStatus> {
    return getBrainStatus(this.agentDir);
  }

  async brainFiles(): Promise<BrainFiles> {
    return getBrainFiles(this.agentDir);
  }

  async systemPrompt(): Promise<SystemPromptResult> {
    return getSystemPrompt(this.agentDir);
  }

  async skills(): Promise<SkillInventory> {
    return getSkills(this.agentDir, this.frameworkSkillsDir);
  }
}
