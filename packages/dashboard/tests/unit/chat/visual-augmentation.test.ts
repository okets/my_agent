import { describe, it, expect } from "vitest";

// Test the heuristic gate separately (extract if needed)
describe("visual augmentation heuristic", () => {
  it("passes for bulleted data with numbers", () => {
    const content = "Results:\n- JavaScript: 65%\n- Python: 45%\n- Go: 12%\n- Rust: 8%";
    const numbers = content.match(/\d+/g) || [];
    const hasBulletedData = /[-•*]\s.*\d/.test(content) || /\|.*\d.*\|/.test(content);
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    expect(hasBulletedData).toBe(true);
  });

  it("fails for prose with incidental numbers", () => {
    const content = "We met on March 15, 2025 at the cafe on 42nd street. There were about 30 people.";
    const numbers = content.match(/\d+/g) || [];
    const hasBulletedData = /[-•*]\s.*\d/.test(content) || /\|.*\d.*\|/.test(content);
    // Numbers pass (3+) but no bulleted data
    expect(hasBulletedData).toBe(false);
  });

  it("passes for table data with numbers", () => {
    const content = "| Country | Population |\n| China | 1,400M |\n| India | 1,380M |\n| USA | 330M |";
    const numbers = content.match(/\d+/g) || [];
    const hasBulletedData = /[-•*]\s.*\d/.test(content) || /\|.*\d.*\|/.test(content);
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    expect(hasBulletedData).toBe(true);
  });
});
