import { describe, it, expect } from "vitest";
import { getSchemaForPath } from "../../src/metadata/schemas/registry.js";
import { validateWorkPatterns } from "../../src/metadata/schemas/work-patterns.js";

describe("Schema Registry", () => {
  it("returns work-patterns schema for correct path", () => {
    const schema = getSchemaForPath("notebook/config/work-patterns.md");
    expect(schema).toBeDefined();
    expect(schema!.validate).toBe(validateWorkPatterns);
  });

  it("returns undefined for unknown path", () => {
    expect(getSchemaForPath("random/file.md")).toBeUndefined();
  });

  it("returns undefined for empty path", () => {
    expect(getSchemaForPath("")).toBeUndefined();
  });
});

describe("validateWorkPatterns", () => {
  it("returns no errors for valid frontmatter", () => {
    const data = {
      jobs: {
        "morning-prep": { cadence: "daily:08:00", model: "haiku" },
        "daily-summary": { cadence: "daily:23:00", model: "haiku" },
      },
    };
    expect(validateWorkPatterns(data)).toEqual([]);
  });

  it("returns error when jobs key is missing", () => {
    const errors = validateWorkPatterns({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("jobs");
  });

  it("returns error when jobs is not an object", () => {
    const errors = validateWorkPatterns({ jobs: "not-an-object" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns error when job is missing cadence", () => {
    const data = { jobs: { "my-job": { model: "haiku" } } };
    const errors = validateWorkPatterns(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("cadence");
  });

  it("returns error for invalid cadence format", () => {
    const data = { jobs: { "my-job": { cadence: "hourly:30", model: "haiku" } } };
    const errors = validateWorkPatterns(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("cadence");
  });

  it("accepts valid daily cadence formats", () => {
    const data = { jobs: { "my-job": { cadence: "daily:08:00", model: "haiku" } } };
    expect(validateWorkPatterns(data)).toEqual([]);
  });

  it("accepts valid weekly cadence formats", () => {
    const data = { jobs: { "my-job": { cadence: "weekly:sunday:09:00", model: "haiku" } } };
    expect(validateWorkPatterns(data)).toEqual([]);
  });

  it("defaults model to haiku when not specified", () => {
    const data = { jobs: { "my-job": { cadence: "daily:08:00" } } };
    // No model specified — should not be an error (defaults to haiku)
    expect(validateWorkPatterns(data)).toEqual([]);
  });

  it("returns error for unknown model alias", () => {
    const data = { jobs: { "my-job": { cadence: "daily:08:00", model: "gpt-5" } } };
    const errors = validateWorkPatterns(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("model");
  });
});
