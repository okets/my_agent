import { describe, it, expect } from "vitest";
import { getTemplate, assembleJobTodos } from "./todo-templates.js";

describe("getTemplate", () => {
  it("returns generic template for 'generic' job type", () => {
    const tpl = getTemplate("generic");
    expect(tpl).toBeDefined();
    expect(tpl!.items.length).toBeGreaterThanOrEqual(2);
    expect(tpl!.items.every((i) => i.mandatory)).toBe(true);
  });

  it("returns research template with sources and chart items", () => {
    const tpl = getTemplate("research");
    expect(tpl).toBeDefined();
    expect(tpl!.items.some((i) => i.text.includes("sources"))).toBe(true);
    expect(tpl!.items.some((i) => i.text.includes("create_chart"))).toBe(true);
  });

  it("still returns capability templates", () => {
    expect(getTemplate("capability_build")).toBeDefined();
    expect(getTemplate("capability_modify")).toBeDefined();
  });
});

describe("assembleJobTodos", () => {
  it("falls back to generic template when no job type specified", () => {
    const items = assembleJobTodos([{ text: "Do the thing" }]);
    expect(items[0].text).toBe("Do the thing");
    expect(items[0].created_by).toBe("delegator");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.length).toBeGreaterThanOrEqual(2);
    expect(frameworkItems.some((i) => i.text.includes("status-report"))).toBe(true);
  });

  it("falls back to generic when job type has no template", () => {
    const items = assembleJobTodos([], "unknown_type");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.length).toBeGreaterThanOrEqual(2);
  });

  it("uses specific template over generic when job type matches", () => {
    const items = assembleJobTodos([], "capability_build");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.some((i) => i.text.includes("CAPABILITY.md"))).toBe(true);
    // Should NOT have generic items mixed in
    expect(frameworkItems.some((i) => i.text.includes("status-report"))).toBe(false);
  });

  it("uses research template for research job type", () => {
    const items = assembleJobTodos([{ text: "Research X" }], "research");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.some((i) => i.text.includes("sources"))).toBe(true);
    expect(frameworkItems.some((i) => i.text.includes("create_chart"))).toBe(true);
  });
});
