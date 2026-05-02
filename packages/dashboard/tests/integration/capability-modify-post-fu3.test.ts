/**
 * M9.4-S4.3 Item D — end-to-end test for capability_modify post-fu3.
 *
 * Locks the post-fu3 + post-S4.3 capability worker contract:
 *
 *   1. Worker spawns via the same path production uses (AppAutomationService.fire)
 *   2. Mock SDK writes BOTH `deliverable.md` (markdown body, no frontmatter)
 *      AND `result.json` (typed metadata: change_type, test_result, summary)
 *   3. All four mandatory todos complete (capability_frontmatter, change_type_set,
 *      test_executed, deliverable_written, completion_report)
 *   4. Job completes (not needs_review)
 *   5. Paper trail (DECISIONS.md) is written at target_path with fields read from
 *      result.json (not deliverable.md frontmatter)
 *
 * The audit (post-fu3-capability-implications.md) flagged the missing e2e for
 * the spawn → deliverable + sidecar → validators → paper trail chain. This is
 * the integration gate the sprint never had.
 *
 * Three cases below cover happy path, missing result.json, and invalid change_type.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AppHarness } from "./app-harness.js";
import { readTodoFile, writeTodoFile } from "../../src/automations/todo-file.js";
import { runValidation } from "../../src/automations/todo-validators.js";

// Mock only the SDK boundary — every other component is real
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadConfig: vi.fn(() => ({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/brain",
    })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../src/automations/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn(async () => "You are a helpful assistant."),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn(async () => "UTC"),
}));

const { createBrainQuery } = await import("@my-agent/core");

function makeAsyncIterable(messages: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) yield msg;
    },
  };
}

/**
 * Mock SDK: when invoked, simulate the worker writing files into run_dir
 * and marking all mandatory todos done. Production capability workers do
 * this themselves via the Write tool + todo MCP server; we shortcut both
 * because the SDK boundary is mocked.
 */
function mockSdkWritesArtifacts(
  findRunDir: () => string | undefined,
  targetDir: string,
  artifacts: {
    deliverable: string;
    result?: object;
    /** Force-skip writing result.json to test the "missing sidecar" failure mode. */
    skipResult?: boolean;
  },
) {
  return () => {
    const runDir = findRunDir();
    if (runDir) {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "deliverable.md"), artifacts.deliverable);
      if (!artifacts.skipResult && artifacts.result) {
        fs.writeFileSync(
          path.join(runDir, "result.json"),
          JSON.stringify(artifacts.result),
        );
      }
      const todoPath = path.join(runDir, "todos.json");
      if (fs.existsSync(todoPath)) {
        // Mirror the production todo MCP path: only mark a mandatory item done
        // if its validator (if any) passes against the on-disk artifacts. This
        // is what the worker would observe when calling todo_done via the MCP
        // tool — invalid result.json (or missing it) leaves the related todos
        // unfinished, which the job-end completion gate then surfaces as
        // needs_review.
        const todos = readTodoFile(todoPath);
        for (const item of todos.items) {
          if (!item.mandatory) continue;
          if (!item.validation) {
            item.status = "done";
            continue;
          }
          const result = runValidation(item.validation, runDir, targetDir);
          item.status = result.pass ? "done" : "in_progress";
        }
        writeTodoFile(todoPath, todos);
      }
    }
    return makeAsyncIterable([
      { type: "system", subtype: "init", session_id: "sess-cap-modify-e2e" },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text:
                "Investigated config and applied the requested change. Smoke run executed; results recorded in result.json sidecar.",
            },
          ],
        },
      },
    ]);
  };
}

function setupCapabilityFolder(harness: AppHarness, capRelPath: string): string {
  // target_path is resolved as path.resolve(agentDir, "..", target_path)
  const projectRoot = path.resolve(harness.agentDir, "..");
  const capDir = path.join(projectRoot, capRelPath);
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(
    path.join(capDir, "CAPABILITY.md"),
    [
      "---",
      "name: Test STT",
      "provides: audio-to-text",
      "interface: script",
      "---",
      "Test capability for S4.3 e2e.",
    ].join("\n"),
  );
  return capDir;
}

function writeCapabilityModifyManifest(
  automationsDir: string,
  id: string,
  targetRelPath: string,
): void {
  fs.writeFileSync(
    path.join(automationsDir, `${id}.md`),
    [
      "---",
      `name: ${id}`,
      "status: active",
      "trigger:",
      "  - type: manual",
      "job_type: capability_modify",
      `target_path: ${targetRelPath}`,
      "autonomy: full",
      "todos:",
      "  - text: Tweak the threshold per spec",
      `created: ${new Date().toISOString()}`,
      "---",
      "",
      "Modify the capability to reduce false positives.",
    ].join("\n"),
  );
}

describe("M9.4-S4.3 capability_modify post-fu3 end-to-end", () => {
  let harness: AppHarness;
  let capRelPath: string;
  let capAbsPath: string;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
    // Unique target each test run so /tmp doesn't collide across runs.
    capRelPath = `s4.3-test-caps/${path.basename(harness.agentDir)}-${Date.now()}`;
    capAbsPath = setupCapabilityFolder(harness, capRelPath);
  });

  afterEach(async () => {
    await harness.shutdown();
    // Clean up the capability folder we wrote outside agentDir.
    if (capAbsPath && fs.existsSync(capAbsPath)) {
      fs.rmSync(capAbsPath, { recursive: true, force: true });
    }
    // And the s4.3-test-caps parent if empty.
    const parent = path.dirname(capAbsPath);
    if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
      fs.rmdirSync(parent);
    }
    vi.clearAllMocks();
  });

  it("happy path — deliverable.md + result.json → validators pass → paper trail uses sidecar fields", async () => {
    writeCapabilityModifyManifest(harness.automationsDir!, "cap-modify-happy", capRelPath);
    await harness.automationManager!.syncAll();

    const findRunDir = () =>
      harness.automationJobService!.listJobs({
        automationId: "cap-modify-happy",
      })[0]?.run_dir;

    (createBrainQuery as any).mockImplementation(
      mockSdkWritesArtifacts(findRunDir, capAbsPath, {
        deliverable:
          "## Configured\n\nLowered the confidence threshold to 0.4 in `config.yaml`. Smoke run passed; existing transcripts unaffected.\n",
        result: {
          change_type: "configure",
          test_result: "pass",
          provider: "Deepgram Nova-2",
          test_duration_ms: 2300,
          files_changed: ["config.yaml"],
          summary: "Lowered threshold to 0.4; smoke green.",
        },
      }),
    );

    await harness.automations!.fire("cap-modify-happy");

    const job = harness.automationJobService!.listJobs({
      automationId: "cap-modify-happy",
    })[0];
    expect(job).toBeDefined();
    // With both files present and all todos done, the job completes.
    expect(job.status).toBe("completed");

    // Both files exist on disk.
    expect(fs.existsSync(path.join(job.run_dir!, "deliverable.md"))).toBe(true);
    expect(fs.existsSync(path.join(job.run_dir!, "result.json"))).toBe(true);

    // Paper trail written from result.json (not from deliverable.md frontmatter).
    const decisionsPath = path.join(capAbsPath, "DECISIONS.md");
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const decisions = fs.readFileSync(decisionsPath, "utf-8");
    expect(decisions).toContain("Change type:** configure");
    expect(decisions).toContain("Provider:** Deepgram Nova-2");
    expect(decisions).toContain("Test:** pass");
    expect(decisions).toContain("config.yaml");
  });

  it("fails loud when result.json is missing — completion_report validator rejects", async () => {
    writeCapabilityModifyManifest(harness.automationsDir!, "cap-modify-no-sidecar", capRelPath);
    await harness.automationManager!.syncAll();

    const findRunDir = () =>
      harness.automationJobService!.listJobs({
        automationId: "cap-modify-no-sidecar",
      })[0]?.run_dir;

    // Worker writes deliverable.md but NOT result.json.
    (createBrainQuery as any).mockImplementation(
      mockSdkWritesArtifacts(findRunDir, capAbsPath, {
        deliverable:
          "## Modified\n\nApplied the requested change but skipped the sidecar (this is the regression case).\n",
        skipResult: true,
      }),
    );

    await harness.automations!.fire("cap-modify-no-sidecar");

    const job = harness.automationJobService!.listJobs({
      automationId: "cap-modify-no-sidecar",
    })[0];
    expect(job).toBeDefined();
    // Without result.json the completion gate flips to needs_review (not "completed")
    // because the validator(s) backing mandatory todos can't pass on the missing sidecar.
    // The mock force-marks todos done, so the job-end gate also relies on this hand-shake;
    // either way the result is NOT a clean "completed".
    expect(job.status).not.toBe("completed");
  });

  it("fails loud when result.json has invalid change_type", async () => {
    writeCapabilityModifyManifest(harness.automationsDir!, "cap-modify-bad-change", capRelPath);
    await harness.automationManager!.syncAll();

    const findRunDir = () =>
      harness.automationJobService!.listJobs({
        automationId: "cap-modify-bad-change",
      })[0]?.run_dir;

    (createBrainQuery as any).mockImplementation(
      mockSdkWritesArtifacts(findRunDir, capAbsPath, {
        deliverable: "## Tried\n\nAttempted but did not classify the change.\n",
        result: {
          change_type: "unknown",
          test_result: "fail",
          summary: "Could not determine root cause.",
        },
      }),
    );

    await harness.automations!.fire("cap-modify-bad-change");

    const job = harness.automationJobService!.listJobs({
      automationId: "cap-modify-bad-change",
    })[0];
    expect(job).toBeDefined();
    // change_type=unknown is explicitly rejected by both completion_report
    // and change_type_set validators, so the job cannot reach a clean "completed".
    expect(job.status).not.toBe("completed");
  });
});
