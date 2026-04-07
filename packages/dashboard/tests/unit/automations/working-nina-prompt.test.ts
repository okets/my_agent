import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWorkingNinaPrompt } from "../../../src/automations/working-nina-prompt.js";

/**
 * M9.2-S8: Worker prompt isolation tests.
 *
 * Sets up a realistic agent dir with brain content that assembleSystemPrompt()
 * would load. Verifies workers do NOT receive that content.
 */

describe("buildWorkingNinaPrompt — worker prompt isolation", () => {
  // testDir/my_agent/ = agentDir, testDir/skills/ = framework skills
  const testDir = join(tmpdir(), `worker-prompt-isolation-${Date.now()}`);
  const agentDir = join(testDir, "my_agent");
  const brainDir = join(agentDir, "brain");
  const frameworkSkillsDir = join(testDir, "skills");

  beforeEach(() => {
    // Brain identity
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(
      join(brainDir, "AGENTS.md"),
      "# Nina\nYou are Nina, a personal AI assistant.",
    );

    // Notebook reference with standing orders
    const refDir = join(agentDir, "notebook", "reference");
    mkdirSync(refDir, { recursive: true });
    writeFileSync(
      join(refDir, "standing-orders.md"),
      "# Standing Orders\n\n## Escalation Rules\n\nAlways escalate.\n\n## Trust Tiers\n\n| Tier | Who |\n|---|---|\n| Full | Owner |",
    );

    // Daily log
    const dailyDir = join(agentDir, "notebook", "daily");
    mkdirSync(dailyDir, { recursive: true });
    const today = new Date().toISOString().split("T")[0];
    writeFileSync(
      join(dailyDir, `${today}.md`),
      "## Recent Daily Logs\n\n- 10:00 — Had a meeting",
    );

    // Framework brain-level skills
    mkdirSync(frameworkSkillsDir, { recursive: true });
    writeFileSync(
      join(frameworkSkillsDir, "conversation-role.md"),
      '---\nname: conversation-role\ndescription: test\nlevel: brain\n---\n\nYou are the conversation layer. You do not do work yourself.\n\nUse `create_automation` to delegate.\n\n## Delegation\n\nAlways delegate research.',
    );
    writeFileSync(
      join(frameworkSkillsDir, "task-triage.md"),
      '---\nname: task-triage\ndescription: test\nlevel: brain\n---\n\n## Interview-First Rule\n\nEvery task MUST start with an interview.\n\n## Automation Design Checklist\n\n1. Name 2. Instructions 3. Todos',
    );

    // Automations directory (for automation hints)
    const automationsDir = join(agentDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    writeFileSync(
      join(automationsDir, "morning-brief.md"),
      '---\nname: morning-brief\nstatus: active\ntrigger:\n  - type: cron\n    hint: morning brief\n---\nPrepare morning brief.',
    );
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does NOT include brain identity or conversation role", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test",
      taskId: "t1",
    });
    expect(prompt).not.toContain("You are the conversation layer");
    expect(prompt).not.toContain("You do not do work yourself");
    expect(prompt).not.toContain("create_automation");
    expect(prompt).not.toContain("Delegation");
  });

  it("does NOT include triage routing or delegation checklist", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test",
      taskId: "t1",
    });
    expect(prompt).not.toContain("task-triage");
    expect(prompt).not.toContain("Automation Design Checklist");
    expect(prompt).not.toContain("Interview-First Rule");
  });

  it("does NOT include daily logs or notebook tree", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test",
      taskId: "t1",
    });
    expect(prompt).not.toContain("Recent Daily Logs");
    expect(prompt).not.toContain("Notebook Directory");
  });

  it("does NOT include standing orders or trust tiers", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test",
      taskId: "t1",
    });
    expect(prompt).not.toContain("Trust Tiers");
    expect(prompt).not.toContain("Escalation Rules");
    expect(prompt).not.toContain("Standing Orders");
  });

  it("does NOT include automation hints", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test",
      taskId: "t1",
    });
    expect(prompt).not.toContain("Active Automations");
    expect(prompt).not.toContain("fire_automation");
  });

  it("includes worker-specific persona and todo system", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test",
      taskId: "t1",
    });
    expect(prompt).toContain("Working Nina");
    expect(prompt).toContain("Pre-Completion Self-Check");
    expect(prompt).toContain("todo_list");
    expect(prompt).toContain("Todo System");
  });

  it("includes temporal context", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "test task",
      taskId: "t1",
    });
    expect(prompt).toContain("Temporal Context");
    expect(prompt).toContain("test task");
  });
});
