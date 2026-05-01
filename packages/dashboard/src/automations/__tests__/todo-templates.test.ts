import { describe, it, expect } from "vitest";
import { getTemplate, assembleJobTodos } from "../todo-templates.js";

describe("todo-templates", () => {
  it("returns CAPABILITY_BUILD template", () => {
    const tpl = getTemplate("capability_build");
    expect(tpl).toBeDefined();
    expect(tpl!.items.length).toBeGreaterThan(0);
    expect(tpl!.items.every((i) => i.mandatory)).toBe(true);
  });

  it("returns CAPABILITY_MODIFY template", () => {
    const tpl = getTemplate("capability_modify");
    expect(tpl).toBeDefined();
    expect(tpl!.items.some((i) => i.validation === "change_type_set")).toBe(
      true,
    );
  });

  it("returns undefined for unknown type", () => {
    expect(getTemplate("unknown_type")).toBeUndefined();
  });

  it("assembleJobTodos merges 3 layers", () => {
    const delegatorTodos = [
      { text: "Add Hebrew to config" },
      { text: "Test Hebrew" },
    ];
    const result = assembleJobTodos(delegatorTodos, "capability_modify");
    // Layer 1: delegator items (mandatory, created_by: delegator)
    const delegated = result.filter((i) => i.created_by === "delegator");
    expect(delegated).toHaveLength(2);
    expect(delegated.every((i) => i.mandatory)).toBe(true);
    // Layer 2: template items (mandatory, created_by: framework)
    const framework = result.filter((i) => i.created_by === "framework");
    expect(framework.length).toBeGreaterThan(0);
    expect(framework.every((i) => i.mandatory)).toBe(true);
  });

  it("assembleJobTodos with no template or todos falls back to generic", () => {
    const result = assembleJobTodos(undefined, undefined);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every((i) => i.created_by === "framework")).toBe(true);
  });

  it("assembleJobTodos with only delegator todos includes generic fallback", () => {
    const result = assembleJobTodos([{ text: "Do this" }], undefined);
    const delegator = result.filter((i) => i.created_by === "delegator");
    const framework = result.filter((i) => i.created_by === "framework");
    expect(delegator).toHaveLength(1);
    expect(delegator[0].mandatory).toBe(true);
    expect(framework.length).toBeGreaterThanOrEqual(2);
  });

  it("assembleJobTodos with only template returns template items", () => {
    // M9.4-S4.3: capability_build template grew from 5 to 6 items —
    // the deliverable-emit step split into deliverable.md (markdown for
    // the user) + result.json (typed framework metadata).
    const result = assembleJobTodos(undefined, "capability_build");
    expect(result.length).toBe(6);
    expect(result.every((i) => i.created_by === "framework")).toBe(true);
  });

  it("IDs are sequential across layers", () => {
    const result = assembleJobTodos(
      [{ text: "Step 1" }],
      "capability_modify",
    );
    const ids = result.map((i) => i.id);
    expect(ids[0]).toBe("t1");
    expect(ids[1]).toBe("t2");
    expect(ids[ids.length - 1]).toBe(`t${result.length}`);
  });

  it("returns generic template with 2+ mandatory items", () => {
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

  it("falls back to generic when job type has no template", () => {
    const items = assembleJobTodos([], "unknown_type");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.length).toBeGreaterThanOrEqual(2);
  });

  it("capability_build does NOT get generic status-report items", () => {
    const items = assembleJobTodos([], "capability_build");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.some((i) => i.text.includes("CAPABILITY.md"))).toBe(true);
    expect(frameworkItems.some((i) => i.text.includes("status-report"))).toBe(false);
  });

  it("uses research template for research job type", () => {
    const items = assembleJobTodos([{ text: "Research X" }], "research");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.some((i) => i.text.includes("sources"))).toBe(true);
    expect(frameworkItems.some((i) => i.text.includes("create_chart"))).toBe(true);
  });
});
