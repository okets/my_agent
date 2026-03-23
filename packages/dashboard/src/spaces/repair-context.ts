import { readDecisions } from "./decisions.js";
import type { Space, SpaceMaintenance } from "@my-agent/core";
import { readFrontmatter } from "../metadata/frontmatter.js";
import path from "node:path";

export interface RepairContext {
  /** Should the worker attempt repair? */
  shouldRepair: boolean;
  /** Repair instructions for the worker prompt */
  repairPrompt: string;
  /** Maintenance policy */
  policy: SpaceMaintenance["on_failure"];
}

/** Build repair context for a failed tool invocation */
export function buildRepairContext(
  space: Space,
  errorOutput: string,
): RepairContext {
  const policy = space.maintenance?.on_failure ?? "alert";

  if (policy === "alert") {
    return {
      shouldRepair: false,
      policy,
      repairPrompt: `Tool "${space.name}" failed. Policy is "alert" -- do NOT attempt repair. Report the failure.`,
    };
  }

  if (policy === "replace") {
    return {
      shouldRepair: false,
      policy,
      repairPrompt: `Tool "${space.name}" failed. Policy is "replace" -- create a new tool space to replace it. Deprecate the old one in DECISIONS.md.`,
    };
  }

  // policy === "fix"
  const decisions = readDecisions(space.path ?? space.manifestDir);
  const maintenanceRules = extractMaintenanceRules(space);

  return {
    shouldRepair: true,
    policy,
    repairPrompt: [
      `Tool "${space.name}" failed with error:`,
      "```",
      errorOutput,
      "```",
      "",
      "## Repair Protocol",
      "",
      "You have ONE attempt to fix this tool. Read the context below before making changes.",
      "",
      "### Maintenance Rules (from SPACE.md)",
      maintenanceRules || "(none specified)",
      "",
      "### Prior Decisions (from DECISIONS.md)",
      decisions || "(no prior decisions)",
      "",
      "### Instructions",
      "1. Diagnose the root cause based on the error and prior decisions",
      "2. Make the minimal fix needed",
      "3. Test with the same input that caused the failure",
      "4. If fixed: log the fix in DECISIONS.md, then continue the job",
      "5. If still broken: log the failure in DECISIONS.md, then fail the job",
    ].join("\n"),
  };
}

/** Extract maintenance rules from SPACE.md body (## Maintenance Rules section) */
function extractMaintenanceRules(space: Space): string {
  try {
    const spaceMdPath = path.join(
      space.path ?? space.manifestDir,
      "SPACE.md",
    );
    const { body } = readFrontmatter(spaceMdPath);
    const match = body.match(
      /## Maintenance Rules\n([\s\S]*?)(?=\n## |\n---|$)/,
    );
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}
