/**
 * Built-in Handler Registry
 *
 * Maps handler keys to standalone TypeScript functions that execute
 * system automations without spawning SDK sessions.
 *
 * Each handler encapsulates the full orchestration: reading context,
 * calling the model, writing output, and returning results.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import type { ConversationDatabase } from "../../conversations/db.js";
import { queryModel, type ModelAlias } from "../query-model.js";
import { loadPreferences } from "@my-agent/core";
import { stripFrontmatter } from "../../automations/summary-resolver.js";

// Import job-specific prompts and logic
import {
  runDebriefPrep,
  formatStagedFactsSection,
  formatStalePropertiesSection,
} from "./debrief-prep.js";
import { runDailySummary } from "./daily-summary.js";
import {
  runWeeklyReview,
  analyzeKnowledge,
  applyPromotions,
} from "./weekly-review.js";
import { runWeeklySummary } from "./weekly-summary.js";
import { runMonthlySummary } from "./monthly-summary.js";
import {
  readStagingFiles,
  cleanExpiredFacts,
  incrementAllAttempts,
} from "../../conversations/knowledge-staging.js";
import {
  readProperties,
  detectStaleProperties,
} from "../../conversations/properties.js";

export type BuiltInHandler = (ctx: {
  agentDir: string;
  db?: ConversationDatabase;
  jobId: string;
}) => Promise<{ success: boolean; work: string; deliverable: string | null }>;

const handlers = new Map<string, BuiltInHandler>();

export function registerHandler(key: string, handler: BuiltInHandler): void {
  handlers.set(key, handler);
}

export function getHandler(key: string): BuiltInHandler | undefined {
  return handlers.get(key);
}

// ─── Helper Utilities ─────────────────────────────────────────────────────

async function readDirMarkdown(dirPath: string): Promise<string> {
  try {
    const files = await readdir(dirPath);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
    const contents: string[] = [];
    for (const file of mdFiles) {
      const content = await readFile(join(dirPath, file), "utf-8");
      contents.push(`## ${file}\n\n${content}`);
    }
    return contents.join("\n\n");
  } catch {
    return "";
  }
}

async function appendToDailyLog(
  notebookDir: string,
  line: string,
): Promise<void> {
  const dailyDir = join(notebookDir, "daily");
  if (!existsSync(dailyDir)) {
    await mkdir(dailyDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().split("T")[0];
  const logPath = join(dailyDir, `${dateStr}.md`);
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (!existsSync(logPath)) {
    await writeFile(
      logPath,
      `# Daily Log — ${dateStr}\n\n${timestamp} ${line}\n`,
    );
  } else {
    const existing = await readFile(logPath, "utf-8");
    await writeFile(logPath, existing + `${timestamp} ${line}\n`);
  }
}

// ─── Handler: debrief-context ─────────────────────────────────────────────
// Assembles notebook context into current-state.md for the system prompt.
// Not user-facing — the debrief-reporter handler delivers the daily brief.
// Renamed from debrief-prep in M7-S8.

registerHandler("debrief-context", async ({ agentDir }) => {
  const notebookDir = join(agentDir, "notebook");
  const sections: string[] = [];

  // Yesterday's daily summary
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdaySummary = join(
    notebookDir,
    "summaries",
    "daily",
    `${yesterdayStr}.md`,
  );
  if (existsSync(yesterdaySummary)) {
    sections.push(
      "# Yesterday's Summary\n" + (await readFile(yesterdaySummary, "utf-8")),
    );
  }

  // Latest weekly summary
  const weeklyDir = join(notebookDir, "summaries", "weekly");
  if (existsSync(weeklyDir)) {
    const weekFiles = (await readdir(weeklyDir))
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (weekFiles.length > 0) {
      const latest = await readFile(
        join(weeklyDir, weekFiles[weekFiles.length - 1]),
        "utf-8",
      );
      sections.push("# This Week\n" + latest);
    }
  }

  // Latest monthly summary
  const monthlyDir = join(notebookDir, "summaries", "monthly");
  if (existsSync(monthlyDir)) {
    const monthFiles = (await readdir(monthlyDir))
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (monthFiles.length > 0) {
      const latest = await readFile(
        join(monthlyDir, monthFiles[monthFiles.length - 1]),
        "utf-8",
      );
      sections.push("# This Month\n" + latest);
    }
  }

  // Today's daily log
  const today = new Date().toISOString().split("T")[0];
  const todayLog = join(notebookDir, "daily", `${today}.md`);
  if (existsSync(todayLog)) {
    sections.push(
      "# Today's Log So Far\n" + (await readFile(todayLog, "utf-8")),
    );
  }

  // User info
  const userInfo = join(notebookDir, "reference", "user-info.md");
  if (existsSync(userInfo)) {
    sections.push("# User Info\n" + (await readFile(userInfo, "utf-8")));
  }

  // Properties
  const propsFile = join(notebookDir, "properties", "status.yaml");
  if (existsSync(propsFile)) {
    sections.push(
      "# Current Properties\n" + (await readFile(propsFile, "utf-8")),
    );
  }

  // Staged knowledge
  const stagingDir = join(notebookDir, "knowledge", "extracted");
  if (existsSync(stagingDir)) {
    const stagingFileList = (await readdir(stagingDir)).filter((f) =>
      f.endsWith(".md"),
    );
    if (stagingFileList.length > 0) {
      const stagingContent: string[] = [];
      for (const f of stagingFileList) {
        stagingContent.push(await readFile(join(stagingDir, f), "utf-8"));
      }
      sections.push(
        "# Pending Knowledge (for approval)\n" + stagingContent.join("\n\n"),
      );
    }
  }

  // Calendar context
  try {
    const {
      loadCalendarConfig,
      loadCalendarCredentials,
      createCalDAVClient,
      assembleCalendarContext,
    } = await import("@my-agent/core");
    const calConfig = loadCalendarConfig(agentDir);
    const calCreds = loadCalendarCredentials(agentDir);
    if (calConfig && calCreds) {
      const calClient = await createCalDAVClient(calConfig, calCreds);
      const calContext = await assembleCalendarContext(calClient);
      if (calContext) {
        sections.push("# Calendar\n" + calContext);
      }
    }
  } catch {
    // Calendar unavailable
  }

  const context =
    sections.length > 0
      ? sections.join("\n\n---\n\n")
      : "No context available.";

  // Clean expired facts
  await cleanExpiredFacts(agentDir, 3);

  // Build staged facts section
  const stagingFiles = await readStagingFiles(agentDir);
  const stagedFactsSection = formatStagedFactsSection(stagingFiles);

  // Build stale properties section
  const properties = await readProperties(agentDir);
  const todayDate = new Date().toISOString().split("T")[0];
  const staleProps = detectStaleProperties(properties, todayDate);
  const stalePropertiesSection = formatStalePropertiesSection(staleProps);

  // Get model preference
  const preferences = loadPreferences(agentDir);
  const model = preferences.debrief.model as ModelAlias;

  const output = await runDebriefPrep(
    context,
    model,
    stagedFactsSection,
    stalePropertiesSection,
  );

  // Auto-increment attempts
  for (const file of stagingFiles) {
    await incrementAllAttempts(file.filePath);
  }

  // Write output
  const opsDir = join(notebookDir, "operations");
  if (!existsSync(opsDir)) {
    await mkdir(opsDir, { recursive: true });
  }
  await writeFile(join(opsDir, "current-state.md"), output, "utf-8");

  await appendToDailyLog(
    notebookDir,
    `- Debrief prep completed (${output.length} chars)`,
  );

  return { success: true, work: output, deliverable: output };
});

// Backward-compat alias (old manifests may reference debrief-prep)
registerHandler("debrief-prep", getHandler("debrief-context")!);

// ─── Handler: debrief-reporter ───────────────────────────────────────────
// Assembles the daily brief by:
// 1. Running debrief-context to refresh current-state.md
// 2. Collecting worker deliverables from disk (no LLM re-digest)
// 3. Writing full report + digest to disk
// M9.4-S4: Converted from LLM digest to pure assembly.

registerHandler("debrief-reporter", async ({ agentDir, db }) => {
  const notebookDir = join(agentDir, "notebook");

  // Step 1: Run debrief-context to refresh current-state.md
  const contextHandler = getHandler("debrief-context");
  if (contextHandler) {
    await contextHandler({ agentDir, jobId: `context-${Date.now()}` });
  }

  // Step 2: Collect worker deliverables (no LLM re-digest)
  const workerSections: string[] = [];
  if (db) {
    const since = new Date(Date.now() - 86400000).toISOString();
    console.log(`[debrief-reporter] Collecting worker results since: ${since}`);
    const pendingJobs = db.getDebriefPendingJobs(since);
    console.log(`[debrief-reporter] Found ${pendingJobs.length} worker reports`);

    for (const job of pendingJobs) {
      const prefix = job.needsReview ? "\u26a0\ufe0f INCOMPLETE \u2014 " : "";
      let content = "";

      // Priority: deliverable.md → status-report.md → summary
      if (job.deliverablePath && existsSync(job.deliverablePath)) {
        try {
          content = stripFrontmatter(await readFile(job.deliverablePath, "utf-8"));
        } catch {
          // Fall through
        }
      }
      if (!content && job.runDir) {
        const reportPath = join(job.runDir, "status-report.md");
        if (existsSync(reportPath)) {
          try {
            content = stripFrontmatter(await readFile(reportPath, "utf-8"));
          } catch {
            // Fall back to summary
          }
        }
      }
      if (!content) {
        content = job.summary ?? "No output available.";
      }

      workerSections.push(`## ${prefix}${job.automationName}\n\n${content}`);
    }
  }

  // Step 3: If no workers ran, skip debrief entirely
  if (workerSections.length === 0) {
    await appendToDailyLog(notebookDir, "- Debrief reporter: no workers to report");
    return {
      success: true,
      work: "No background work to report.",
      deliverable: "No background work to report.",
    };
  }

  // Step 4: Write full report and digest to disk
  const opsDir = join(notebookDir, "operations");
  if (!existsSync(opsDir)) {
    await mkdir(opsDir, { recursive: true });
  }

  // Read current-state.md for context in full report
  const currentStatePath = join(notebookDir, "operations", "current-state.md");
  let notebookContext = "";
  if (existsSync(currentStatePath)) {
    notebookContext = await readFile(currentStatePath, "utf-8");
  }

  const fullBrief = [
    notebookContext,
    "---\n\n# Worker Reports\n\n" + workerSections.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  await writeFile(join(opsDir, "debrief-full.md"), fullBrief, "utf-8");

  // Digest IS the worker sections (no LLM summarization)
  const digest = workerSections.join("\n\n---\n\n");
  await writeFile(join(opsDir, "debrief-digest.md"), digest, "utf-8");

  await appendToDailyLog(
    notebookDir,
    `- Debrief reporter: assembled ${workerSections.length} worker reports (${digest.length} chars digest, no LLM)`,
  );

  return { success: true, work: digest, deliverable: digest };
});

// ─── Handler: daily-summary ──────────────────────────────────────────────

registerHandler("daily-summary", async ({ agentDir }) => {
  const notebookDir = join(agentDir, "notebook");

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayFile = join(notebookDir, "daily", `${yesterdayStr}.md`);

  let context: string;
  if (existsSync(yesterdayFile)) {
    context = await readFile(yesterdayFile, "utf-8");
  } else {
    context = "No daily log for yesterday.";
  }

  const output = await runDailySummary(context);

  const summaryDir = join(notebookDir, "summaries", "daily");
  if (!existsSync(summaryDir)) {
    await mkdir(summaryDir, { recursive: true });
  }
  await writeFile(join(summaryDir, `${yesterdayStr}.md`), output, "utf-8");

  return { success: true, work: output, deliverable: output };
});

// ─── Handler: weekly-review ──────────────────────────────────────────────

registerHandler("weekly-review", async ({ agentDir }) => {
  const notebookDir = join(agentDir, "notebook");
  const output = await runWeeklyReview(agentDir);

  await appendToDailyLog(
    notebookDir,
    `- Weekly review completed (${output.length} chars)`,
  );

  return { success: true, work: output, deliverable: output };
});

// ─── Handler: weekly-summary ─────────────────────────────────────────────

registerHandler("weekly-summary", async ({ agentDir }) => {
  const notebookDir = join(agentDir, "notebook");
  const summaryDir = join(notebookDir, "summaries", "daily");

  const sections: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const filePath = join(summaryDir, `${dateStr}.md`);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      sections.push(`### ${dateStr}\n${content}`);
    }
  }

  if (sections.length === 0) {
    return {
      success: true,
      work: "Quiet week -- no daily summaries found.",
      deliverable: null,
    };
  }

  const output = await runWeeklySummary(sections.join("\n\n"));

  const weeklyDir = join(notebookDir, "summaries", "weekly");
  if (!existsSync(weeklyDir)) {
    await mkdir(weeklyDir, { recursive: true });
  }

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((now.getTime() - yearStart.getTime()) / 86400000 +
      yearStart.getDay() +
      1) /
      7,
  );
  const weekStr = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  await writeFile(join(weeklyDir, `${weekStr}.md`), output, "utf-8");

  return { success: true, work: output, deliverable: output };
});

// ─── Handler: monthly-summary ────────────────────────────────────────────

registerHandler("monthly-summary", async ({ agentDir }) => {
  const notebookDir = join(agentDir, "notebook");
  const weeklyDir = join(notebookDir, "summaries", "weekly");

  if (!existsSync(weeklyDir)) {
    return {
      success: true,
      work: "Quiet month -- no weekly summaries found.",
      deliverable: null,
    };
  }

  const files = await readdir(weeklyDir);
  const sections: string[] = [];
  for (const f of files.filter((f) => f.endsWith(".md")).sort()) {
    const content = await readFile(join(weeklyDir, f), "utf-8");
    sections.push(`### ${f.replace(".md", "")}\n${content}`);
  }

  if (sections.length === 0) {
    return { success: true, work: "Quiet month.", deliverable: null };
  }

  const output = await runMonthlySummary(sections.join("\n\n"));

  const monthlyDir = join(notebookDir, "summaries", "monthly");
  if (!existsSync(monthlyDir)) {
    await mkdir(monthlyDir, { recursive: true });
  }

  const monthStr = new Date().toISOString().slice(0, 7);
  await writeFile(join(monthlyDir, `${monthStr}.md`), output, "utf-8");

  return { success: true, work: output, deliverable: output };
});
