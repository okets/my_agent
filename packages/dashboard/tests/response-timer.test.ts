import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ResponseTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes typing indicator every 10s", async () => {
    const { ResponseTimer } = await import("../src/channels/response-timer.js");
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const sendInterim = vi.fn().mockResolvedValue(undefined);

    const timer = new ResponseTimer({ sendTyping, sendInterim });
    timer.start();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    timer.cancel();
  });

  it("sends first interim message at 30s", async () => {
    const { ResponseTimer } = await import("../src/channels/response-timer.js");
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const sendInterim = vi.fn().mockResolvedValue(undefined);

    const timer = new ResponseTimer({ sendTyping, sendInterim });
    timer.start();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendInterim).toHaveBeenCalledTimes(1);

    timer.cancel();
  });

  it("sends second interim message at 90s", async () => {
    const { ResponseTimer } = await import("../src/channels/response-timer.js");
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const sendInterim = vi.fn().mockResolvedValue(undefined);

    const timer = new ResponseTimer({ sendTyping, sendInterim });
    timer.start();

    await vi.advanceTimersByTimeAsync(90_000);
    expect(sendInterim).toHaveBeenCalledTimes(2);

    timer.cancel();
  });

  it("does not send more than 2 interim messages", async () => {
    const { ResponseTimer } = await import("../src/channels/response-timer.js");
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const sendInterim = vi.fn().mockResolvedValue(undefined);

    const timer = new ResponseTimer({ sendTyping, sendInterim });
    timer.start();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(sendInterim).toHaveBeenCalledTimes(2);

    timer.cancel();
  });

  it("cancel() stops all timers", async () => {
    const { ResponseTimer } = await import("../src/channels/response-timer.js");
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const sendInterim = vi.fn().mockResolvedValue(undefined);

    const timer = new ResponseTimer({ sendTyping, sendInterim });
    timer.start();

    timer.cancel();

    await vi.advanceTimersByTimeAsync(90_000);
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendInterim).not.toHaveBeenCalled();
  });
});
