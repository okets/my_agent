import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutomationProcessor, type AutomationProcessorConfig } from "../../src/automations/automation-processor.js";
import type { Automation, Job } from "@my-agent/core";

function makeAutomation(overrides?: Partial<Automation>): Automation {
  return {
    id: "auto-1",
    manifest: {
      name: "Test Automation",
      status: "active",
      trigger: [{ type: "manual" }],
      notify: "debrief",
      ...overrides?.manifest,
    } as any,
    instructions: "Do something",
    ...overrides,
  } as Automation;
}

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    automationId: "auto-1",
    status: "pending",
    created: new Date().toISOString(),
    run_dir: "/tmp/test-run",
    ...overrides,
  };
}

describe("needs_review notification", () => {
  let config: AutomationProcessorConfig;
  let processor: AutomationProcessor;
  let alertFn: ReturnType<typeof vi.fn>;
  let initiateFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    alertFn = vi.fn().mockResolvedValue(true);
    initiateFn = vi.fn().mockResolvedValue({});

    config = {
      automationManager: {} as any,
      executor: {
        run: vi.fn().mockResolvedValue({
          success: false,
          work: "",
          deliverable: null,
        }),
      } as any,
      jobService: {
        createJob: vi.fn(() => makeJob()),
        updateJob: vi.fn(),
        getJob: vi.fn(),
      } as any,
      conversationInitiator: {
        alert: alertFn,
        initiate: initiateFn,
      },
    };
  });

  it("calls ConversationInitiator.alert() when job status is needs_review", async () => {
    (config.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ status: "needs_review", summary: "Should we deploy to production?" }),
    );

    processor = new AutomationProcessor(config);
    await processor.executeAndDeliver(makeAutomation());

    expect(alertFn).toHaveBeenCalledWith(
      expect.stringContaining("needs the user's input"),
    );
    expect(alertFn).toHaveBeenCalledWith(
      expect.stringContaining("Should we deploy to production?"),
    );
  });

  it("falls back to initiate() when alert returns false", async () => {
    alertFn.mockResolvedValue(false);
    (config.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ status: "needs_review", summary: "Approve this change?" }),
    );

    processor = new AutomationProcessor(config);
    await processor.executeAndDeliver(makeAutomation());

    expect(initiateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        firstTurnPrompt: expect.stringContaining("needs the user's input"),
      }),
    );
  });

  it("includes the review question from job summary in the alert prompt", async () => {
    const question = "Should I proceed with the $5000 purchase?";
    (config.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ status: "needs_review", summary: question }),
    );

    processor = new AutomationProcessor(config);
    await processor.executeAndDeliver(makeAutomation());

    expect(alertFn).toHaveBeenCalledWith(
      expect.stringContaining(question),
    );
  });

  it("includes resume_job instructions in the prompt", async () => {
    (config.jobService.createJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ id: "job-xyz" }),
    );
    (config.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ id: "job-xyz", status: "needs_review", summary: "Review?" }),
    );

    processor = new AutomationProcessor(config);
    await processor.executeAndDeliver(makeAutomation());

    expect(alertFn).toHaveBeenCalledWith(
      expect.stringContaining('resume_job("job-xyz"'),
    );
  });

  it("does not alert when job status is completed", async () => {
    (config.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ status: "completed" }),
    );
    (config.executor.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      work: "done",
      deliverable: null,
    });

    processor = new AutomationProcessor(config);
    await processor.executeAndDeliver(makeAutomation());

    // Alert should NOT have been called for needs_review (only for immediate notify)
    const needsReviewCalls = alertFn.mock.calls.filter(
      (call: [string]) => call[0].includes("needs the user's input"),
    );
    expect(needsReviewCalls.length).toBe(0);
  });

  it("does not alert when conversationInitiator is null", async () => {
    config.conversationInitiator = null;
    (config.jobService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(
      makeJob({ status: "needs_review", summary: "Review?" }),
    );

    processor = new AutomationProcessor(config);
    // Should not throw
    await processor.executeAndDeliver(makeAutomation());

    expect(alertFn).not.toHaveBeenCalled();
  });
});
