import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Tests the create_automation todos schema enforcement.
 *
 * The Zod schema below mirrors the production schema in automation-server.ts.
 * todos must be required (.min(1)) in the Zod schema (MCP tool contract)
 * while remaining optional in the TypeScript AutomationManifest interface.
 */
const todosSchema = z
  .array(z.object({ text: z.string() }))
  .min(1);

describe("create_automation todos enforcement", () => {
  it("rejects undefined (missing todos field)", () => {
    const result = todosSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  it("rejects empty todos array", () => {
    const result = todosSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("accepts a single-item todo", () => {
    const result = todosSchema.safeParse([{ text: "Check the weather" }]);
    expect(result.success).toBe(true);
  });

  it("accepts multiple todos", () => {
    const result = todosSchema.safeParse([
      { text: "Step 1: Research options" },
      { text: "Step 2: Compare prices" },
    ]);
    expect(result.success).toBe(true);
  });
});
