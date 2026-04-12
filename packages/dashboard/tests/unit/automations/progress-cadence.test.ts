import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutomationExecutor } from "../../../src/automations/automation-executor.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Automation, TodoItem } from "@my-agent/core";

vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadConfig: vi.fn(() => ({ model: "claude-sonnet-4-6", brainDir: "/tmp/brain" })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../../src/tasks/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn(async () => "You are a helpful assistant."),
}));

// Unit tests for the Progress Cadence prompt section (M9.4-S6).
// Exercises the private buildAutomationContext via an (executor as any) shim.
describe("Progress Cadence prompt section", () => {
  let db: ConversationDatabase;
  let manager: AutomationManager;
  let jobService: AutomationJobService;
  let executor: AutomationExecutor;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "progress-cadence-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    manager = new AutomationManager(automationsDir, db);
    jobService = new AutomationJobService(automationsDir, db);
    executor = new AutomationExecutor({
      automationManager: manager,
      jobService,
      agentDir: tempDir,
      db,
    });
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  function makeAutomation(): Automation {
    return manager.create({
      name: "Sample Automation",
      instructions: "Do the thing.",
      manifest: {
        trigger: [{ type: "manual" }],
        autonomy: "full",
      },
    });
  }

  function makeTodos(specs: Array<[string, string]>): TodoItem[] {
    return specs.map(([id, text]) => ({
      id,
      text,
      status: "pending",
      mandatory: false,
      created_by: "framework",
    }));
  }

  function buildContext(
    automation: Automation,
    todoItems: TodoItem[] = [],
  ): string {
    return (executor as any).buildAutomationContext(
      automation,
      [],
      undefined,
      todoItems,
    );
  }

  it("appends Progress Cadence as the last section when todos are present", () => {
    const automation = makeAutomation();
    const todos = makeTodos([
      ["research", "Research latest CNN homepage structure"],
      ["screenshot", "Take screenshot of cnn.com homepage"],
      ["report", "Write deliverable with observations"],
    ]);

    const context = buildContext(automation, todos);

    expect(context).toContain("## Progress Cadence");

    const headingOffsets: Array<{ heading: string; idx: number }> = [];
    const re = /(^|\n)(## [^\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(context)) !== null) {
      headingOffsets.push({ heading: match[2], idx: match.index });
    }
    expect(headingOffsets.length).toBeGreaterThan(0);
    const last = headingOffsets[headingOffsets.length - 1];
    expect(last.heading).toMatch(/^## Progress Cadence/);
  });

  it("inlines todos as `- [id: X] text` bullets in order", () => {
    const automation = makeAutomation();
    const todos = makeTodos([
      ["a", "T1"],
      ["b", "T2"],
      ["c", "T3"],
    ]);

    const context = buildContext(automation, todos);

    const cadenceStart = context.indexOf("## Progress Cadence");
    expect(cadenceStart).toBeGreaterThan(-1);
    const cadenceSection = context.slice(cadenceStart);

    expect(cadenceSection).toContain("- [id: a] T1");
    expect(cadenceSection).toContain("- [id: b] T2");
    expect(cadenceSection).toContain("- [id: c] T3");

    const iA = cadenceSection.indexOf("- [id: a] T1");
    const iB = cadenceSection.indexOf("- [id: b] T2");
    const iC = cadenceSection.indexOf("- [id: c] T3");
    expect(iA).toBeLessThan(iB);
    expect(iB).toBeLessThan(iC);
  });

  it("omits the Progress Cadence section when todoItems is empty", () => {
    const automation = makeAutomation();
    const context = buildContext(automation, []);
    expect(context).not.toContain("## Progress Cadence");
  });

  it("omits the Progress Cadence section when todoItems arg is defaulted", () => {
    // Handler-dispatched jobs never reach buildAutomationContext in run();
    // belt-and-braces that the handler path cannot accidentally emit the
    // section even if future refactors alter call order.
    const automation = makeAutomation();
    const context = (executor as any).buildAutomationContext(
      automation,
      [],
      undefined,
    );
    expect(context).not.toContain("## Progress Cadence");
  });

  it("includes the first-tool-call and anti-pattern guidance verbatim", () => {
    const automation = makeAutomation();
    const todos = makeTodos([["only", "Do the only thing"]]);

    const context = buildContext(automation, todos);

    expect(context).toContain(
      "The first tool call of this job MUST be `todo_in_progress` on your first step.",
    );
    expect(context).toContain("Do **not** batch todo updates at the end.");
    expect(context).toContain(
      "Do **not** mark multiple steps in_progress simultaneously.",
    );
  });
});
