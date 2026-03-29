import { describe, it, expect } from "vitest";
import { computeDiffRatio, tagByDiff } from "../../../src/visual/screenshot-tagger.js";

describe("computeDiffRatio", () => {
  it("returns 0 for identical buffers", () => {
    const a = Buffer.from([10, 20, 30, 40]);
    const b = Buffer.from([10, 20, 30, 40]);
    expect(computeDiffRatio(a, b)).toBe(0);
  });

  it("returns 1 for completely different buffers", () => {
    const a = Buffer.from([0, 0, 0, 0]);
    const b = Buffer.from([1, 1, 1, 1]);
    expect(computeDiffRatio(a, b)).toBe(1);
  });

  it("returns ~0.5 for half-different buffers", () => {
    const a = Buffer.from([0, 0, 0, 0]);
    const b = Buffer.from([1, 1, 0, 0]);
    expect(computeDiffRatio(a, b)).toBe(0.5);
  });

  it("handles different length buffers by using the shorter length", () => {
    const a = Buffer.from([0, 0, 0, 0, 0, 0]); // 6 bytes
    const b = Buffer.from([1, 1, 0, 0]);        // 4 bytes — shorter
    // 2 out of 4 bytes differ
    expect(computeDiffRatio(a, b)).toBe(0.5);
  });
});

describe("tagByDiff", () => {
  it("keeps the first screenshot when there is no previous", () => {
    const current = Buffer.from([10, 20, 30, 40]);
    expect(tagByDiff(current, null)).toBe("keep");
  });

  it("skips when screenshots are similar (5% change, below 15% threshold)", () => {
    // 100-byte buffers with 5 bytes different → 5% diff
    const current = Buffer.alloc(100, 0);
    const previous = Buffer.alloc(100, 0);
    for (let i = 0; i < 5; i++) previous[i] = 1;
    expect(tagByDiff(current, previous)).toBe("skip");
  });

  it("keeps when screenshots differ significantly (30% change, above threshold)", () => {
    // 100-byte buffers with 30 bytes different → 30% diff
    const current = Buffer.alloc(100, 0);
    const previous = Buffer.alloc(100, 0);
    for (let i = 0; i < 30; i++) previous[i] = 1;
    expect(tagByDiff(current, previous)).toBe("keep");
  });
});
