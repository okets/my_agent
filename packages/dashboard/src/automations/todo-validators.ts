import fs from "node:fs";
import path from "node:path";
import type { ValidationResult } from "@my-agent/core";
import { readFrontmatter } from "../metadata/frontmatter.js";

/**
 * Validator function signature.
 * - runDir: the job's run directory (where deliverable.md, todos.json live)
 * - targetDir: the artifact directory (where CAPABILITY.md lives), if set
 *
 * Validators checking deliverables use runDir.
 * Validators checking capability artifacts use targetDir (falls back to runDir).
 */
type ValidatorFn = (runDir: string, targetDir?: string) => ValidationResult;

const VALIDATORS: Record<string, ValidatorFn> = {
  capability_frontmatter: (runDir, targetDir) => {
    // CAPABILITY.md lives in the target capability folder, not the run dir
    const dir = targetDir ?? runDir;
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

  completion_report: (runDir) => {
    const delPath = path.join(runDir, "deliverable.md");
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

  test_executed: (runDir) => {
    const delPath = path.join(runDir, "deliverable.md");
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

  status_report: (runDir) => {
    const reportPath = path.join(runDir, "status-report.md");
    if (!fs.existsSync(reportPath)) {
      return {
        pass: false,
        message:
          "status-report.md not found in workspace. Write it with: what you did, what you found, artifacts created, any issues.",
      };
    }
    const content = fs.readFileSync(reportPath, "utf-8").trim();
    if (content.length < 50) {
      return {
        pass: false,
        message:
          "status-report.md is too short (< 50 chars). Include meaningful content: actions, results, artifacts, issues.",
      };
    }
    return { pass: true };
  },

  deliverable_written: (runDir) => {
    const delPath = path.join(runDir, "deliverable.md");
    if (!fs.existsSync(delPath)) {
      return {
        pass: false,
        message: "deliverable.md not found — write your deliverable before marking this done",
      };
    }
    const content = fs.readFileSync(delPath, "utf-8").trim();
    if (content.length < 50) {
      return {
        pass: false,
        message: "deliverable.md is too short (< 50 chars). Include meaningful deliverable content.",
      };
    }
    return { pass: true };
  },

  change_type_set: (runDir) => {
    const delPath = path.join(runDir, "deliverable.md");
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

export function runValidation(
  ruleId: string,
  runDir: string,
  targetDir?: string,
): ValidationResult {
  const validator = VALIDATORS[ruleId];
  if (!validator) return { pass: true };
  return validator(runDir, targetDir);
}
