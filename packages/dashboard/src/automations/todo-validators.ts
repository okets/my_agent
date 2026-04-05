import fs from "node:fs";
import path from "node:path";
import type { ValidationResult } from "@my-agent/core";
import { readFrontmatter } from "../metadata/frontmatter.js";

type ValidatorFn = (dir: string) => ValidationResult;

const VALIDATORS: Record<string, ValidatorFn> = {
  capability_frontmatter: (dir) => {
    const capPath = path.join(dir, "CAPABILITY.md");
    if (!fs.existsSync(capPath)) {
      return { pass: false, message: "CAPABILITY.md not found" };
    }
    const { data } = readFrontmatter<{
      name?: string;
      provides?: string;
      interface?: string;
    }>(capPath);
    if (!data.name)
      return {
        pass: false,
        message: "CAPABILITY.md missing required 'name' field",
      };
    if (!data.provides)
      return {
        pass: false,
        message: "CAPABILITY.md missing required 'provides' field",
      };
    if (!data.interface)
      return {
        pass: false,
        message: "CAPABILITY.md missing required 'interface' field",
      };
    return { pass: true };
  },

  completion_report: (dir) => {
    const delPath = path.join(dir, "deliverable.md");
    if (!fs.existsSync(delPath)) {
      return {
        pass: false,
        message: "deliverable.md not found — write your completion report",
      };
    }
    const { data } = readFrontmatter<{ change_type?: string }>(delPath);
    if (!data.change_type || data.change_type === "unknown") {
      return {
        pass: false,
        message:
          "Completion report missing or has 'unknown' change_type. Set it to: configure, upgrade, fix, or replace",
      };
    }
    return { pass: true };
  },

  test_executed: (dir) => {
    const delPath = path.join(dir, "deliverable.md");
    if (!fs.existsSync(delPath)) {
      return {
        pass: false,
        message: "deliverable.md not found — record your test results",
      };
    }
    const { data } = readFrontmatter<{ test_result?: string }>(delPath);
    if (!data.test_result) {
      return {
        pass: false,
        message:
          "No test_result in deliverable frontmatter. Run the test harness and record the result.",
      };
    }
    return { pass: true };
  },

  change_type_set: (dir) => {
    const delPath = path.join(dir, "deliverable.md");
    if (!fs.existsSync(delPath)) {
      return { pass: false, message: "deliverable.md not found" };
    }
    const { data } = readFrontmatter<{ change_type?: string }>(delPath);
    if (!data.change_type || data.change_type === "unknown") {
      return {
        pass: false,
        message:
          "change_type not determined. Set to: configure, upgrade, fix, or replace",
      };
    }
    return { pass: true };
  },
};

export function runValidation(ruleId: string, dir: string): ValidationResult {
  const validator = VALIDATORS[ruleId];
  if (!validator) return { pass: true }; // Unknown validator = no restriction
  return validator(dir);
}
