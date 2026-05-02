import fs from "node:fs";
import path from "node:path";
import type { ValidationResult } from "@my-agent/core";
import { readFrontmatter } from "../metadata/frontmatter.js";

/**
 * Validator function signature.
 * - runDir: the job's run directory (where deliverable.md, result.json,
 *   todos.json live)
 * - targetDir: the artifact directory (where CAPABILITY.md lives), if set
 *
 * Validators checking the user-facing deliverable use runDir → deliverable.md.
 * Validators checking framework metadata use runDir → result.json sidecar.
 * Validators checking capability artifacts use targetDir (falls back to runDir).
 */
type ValidatorFn = (runDir: string, targetDir?: string) => ValidationResult;

/**
 * Read structured worker telemetry from `result.json` sidecar.
 * Returns either parsed data or a ValidationResult-shaped failure that
 * the caller can return directly.
 *
 * M9.4-S4.3: capability metadata moved out of deliverable.md frontmatter
 * into a JSON sidecar. Markdown is for humans, JSON is for the framework.
 */
function readResultJson(
  runDir: string,
): { ok: true; data: Record<string, unknown> } | { ok: false; failure: ValidationResult } {
  const resultPath = path.join(runDir, "result.json");
  if (!fs.existsSync(resultPath)) {
    return {
      ok: false,
      failure: {
        pass: false,
        message:
          "result.json not found — write the framework metadata sidecar (the structured fields the framework reads, separate from the user-facing deliverable.md)",
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      failure: {
        pass: false,
        message: `result.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: { pass: false, message: "result.json must be a JSON object" },
    };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

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
    const r = readResultJson(runDir);
    if (!r.ok) return r.failure;
    const changeType = r.data.change_type;
    if (
      typeof changeType !== "string" ||
      !changeType ||
      changeType === "unknown"
    ) {
      return {
        pass: false,
        message:
          "result.json missing or has 'unknown' change_type. Set it to: configure, upgrade, fix, or replace",
      };
    }
    return { pass: true };
  },

  test_executed: (runDir) => {
    const r = readResultJson(runDir);
    if (!r.ok) return r.failure;
    const testResult = r.data.test_result;
    if (typeof testResult !== "string" || !testResult) {
      return {
        pass: false,
        message:
          "No test_result in result.json. Run the test harness and record the result in the sidecar.",
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
    const { body: rawBody } = readFrontmatter<Record<string, unknown>>(delPath);
    const body = rawBody.trim();
    if (body.length < 50) {
      return {
        pass: false,
        message:
          "deliverable.md body is too short (< 50 chars after frontmatter). Include a substantive summary of your work — key findings, outcomes, and recommendations.",
      };
    }

    // M9.4-S4.2 Task 5 — doubled-signal narration heuristic.
    // The brief pipeline was contaminated by stream-of-consciousness openers
    // ("Let me start by checking my todo list. Now let me look at the …").
    // Reject if (a) the head matches a strong narration opener, or
    // (b) two or more weak narration markers appear within the first 300 chars.
    const STRONG_OPENERS = [
      /^Let me start by\b/i,
      /^I'll start (by|executing)\b/i, // M9.4-S4.2-fu1: cover Day-1 verb "I'll start executing"
      /^I'll help (you )?(condense|summarize|format)\b/i,
      /^Now I'll (start|check|look)\b/i,
      /^Here'?s what I'?ll do\b/i,
      /^Let'?s check\b/i,
    ];
    // M9.4-S4.2-fu1: widened to cover narration verbs Day-1 surfaced
    // (`Let me get/find/search/create/locate`, `Now I need (to)?`, plus the
    // `I'll <verb>` parallels). FP guard: "I need to flag" still passes
    // because it's not "I'll start", and a single weak match doesn't trip.
    const SECOND_MARKERS =
      /\b(Now let me|Now I need(?: to)?|Let me (check|look|fetch|read|get|find|search|create|locate)|I'll (check|fetch|read|look|get|find|search|create|locate))\b/gi;

    const head = body.slice(0, 300);
    if (STRONG_OPENERS.some((p) => p.test(head))) {
      return {
        pass: false,
        message:
          "deliverable.md opens with a stream-of-consciousness narration pattern. Use the Write tool to emit the final report only — do not narrate your process.",
      };
    }
    const secondMatches = (head.match(SECOND_MARKERS) || []).length;
    if (secondMatches >= 2) {
      return {
        pass: false,
        message: `deliverable.md head contains ${secondMatches} narration markers — this looks like stream-of-consciousness, not a final report. Use the Write tool to emit the deliverable directly.`,
      };
    }

    return { pass: true };
  },

  change_type_set: (runDir) => {
    const r = readResultJson(runDir);
    if (!r.ok) return r.failure;
    const changeType = r.data.change_type;
    if (
      typeof changeType !== "string" ||
      !changeType ||
      changeType === "unknown"
    ) {
      return {
        pass: false,
        message:
          "change_type not determined in result.json. Set to: configure, upgrade, fix, or replace",
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
