/**
 * Work Loop Scheduler
 *
 * Polls every 60s, checks which background Haiku jobs are due,
 * and executes them sequentially. Job definitions come from
 * `notebook/config/work-patterns.md` (markdown = source of truth).
 *
 * Execution history stored in `work_loop_runs` table (SQLite).
 * Following the TaskScheduler pattern for consistency.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  readFile,
  writeFile,
  appendFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { loadWorkPatterns, isDue, isValidTimezone, type WorkPattern } from "./work-patterns.js";
import { validateAndNotify } from "../metadata/validator.js";
import {
  runDebriefPrep,
  formatStagedFactsSection,
  formatStalePropertiesSection,
  SYSTEM_PROMPT as MORNING_SYSTEM,
  USER_PROMPT_TEMPLATE as MORNING_USER,
} from "./jobs/debrief-prep.js";
import type { ModelAlias } from "./query-model.js";
import { loadPreferences } from "@my-agent/core";
import type { TaskManager } from "../tasks/task-manager.js";
import { readProperties, detectStaleProperties } from "../conversations/properties.js";
import {
  readStagingFiles,
  cleanExpiredFacts,
  incrementAllAttempts,
} from "../conversations/knowledge-staging.js";
import {
  runDailySummary,
  SYSTEM_PROMPT as SUMMARY_SYSTEM,
  USER_PROMPT_TEMPLATE as SUMMARY_USER,
} from "./jobs/daily-summary.js";
import {
  runWeeklyReview,
  SYSTEM_PROMPT as REVIEW_SYSTEM,
  USER_PROMPT_TEMPLATE as REVIEW_USER,
} from "./jobs/weekly-review.js";
import { runWeeklySummary } from "./jobs/weekly-summary.js";
import { runMonthlySummary } from "./jobs/monthly-summary.js";

export interface WorkLoopSchedulerConfig {
  db: Database.Database;
  agentDir: string;
  pollIntervalMs?: number;
  /** Optional notification service for morning brief context (spec §5) and validation (spec §4) */
  notificationService?: {
    getPending: () => Array<{ type: string; message?: string; question?: string; problem?: string }>;
    requestInput: (input: {
      question: string;
      options: string[] | Array<{ label: string; value: string }>;
    }) => { id: string };
    notify: (input: { message: string; importance?: "info" | "warning" | "success" | "error" }) => void;
  };
  /** Optional ConversationInitiator for proactive outreach after debrief prep (M6.9-S3) */
  conversationInitiator?: {
    alert(prompt: string): Promise<boolean>;
    initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
  };
  /** Optional TaskManager for including completed tasks in debrief */
  taskManager?: TaskManager | null;
}

interface WorkLoopRun {
  id: string;
  job_name: string;
  started_at: string;
  completed_at: string | null;
  status: "pending" | "running" | "completed" | "failed";
  duration_ms: number | null;
  output: string | null;
  error: string | null;
}

/**
 * WorkLoopScheduler — polls for and runs due background Haiku jobs
 */
export class WorkLoopScheduler {
  private db: Database.Database;
  private agentDir: string;
  private pollIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isExecuting = false;
  private activeCheck: Promise<void> | null = null;
  private patterns: WorkPattern[] = [];
  private notificationService: WorkLoopSchedulerConfig["notificationService"];
  private conversationInitiator: WorkLoopSchedulerConfig["conversationInitiator"];
  private taskManager: TaskManager | null;

  constructor(config: WorkLoopSchedulerConfig) {
    this.db = config.db;
    this.agentDir = config.agentDir;
    this.pollIntervalMs = config.pollIntervalMs ?? 60_000;
    this.notificationService = config.notificationService;
    this.conversationInitiator = config.conversationInitiator;
    this.taskManager = config.taskManager ?? null;

    this.initDb();
  }

  /**
   * Create the work_loop_runs table if it doesn't exist
   */
  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_loop_runs (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        duration_ms INTEGER DEFAULT NULL,
        output TEXT,
        error TEXT
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_work_loop_runs_job_name
      ON work_loop_runs(job_name, started_at DESC);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_work_loop_runs_status
      ON work_loop_runs(status);
    `);
  }

  /**
   * Start the scheduler — loads patterns and begins polling
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("[WorkLoop] Already running");
      return;
    }

    this.patterns = await loadWorkPatterns(this.agentDir);
    this.isRunning = true;
    this.interval = setInterval(() => {
      this.activeCheck = this.checkDueJobs().finally(() => {
        this.activeCheck = null;
      });
    }, this.pollIntervalMs);

    console.log(
      `[WorkLoop] Started, polling every ${this.pollIntervalMs / 1000}s with ${this.patterns.length} job(s)`,
    );

    // Validate frontmatter 5 minutes after start (spec §4.2, non-blocking)
    setTimeout(() => {
      const workPatternsPath = `${this.agentDir}/notebook/config/work-patterns.md`;
      validateAndNotify(workPatternsPath, this.agentDir, this.notificationService);
    }, 5 * 60_000);

    // Check immediately on start (tracked)
    this.activeCheck = this.checkDueJobs().finally(() => {
      this.activeCheck = null;
    });
  }

  /**
   * Stop the scheduler — waits for in-flight job to complete
   */
  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;

    // Wait for active check cycle to complete (includes any in-flight job)
    if (this.activeCheck) {
      console.log("[WorkLoop] Waiting for in-flight job to complete...");
      await this.activeCheck;
    }

    console.log("[WorkLoop] Stopped");
  }

  /**
   * Reload work patterns from disk (called on file change)
   */
  async reloadPatterns(): Promise<void> {
    this.patterns = await loadWorkPatterns(this.agentDir);

    // Validate frontmatter on reload (spec §4.2)
    const workPatternsPath = `${this.agentDir}/notebook/config/work-patterns.md`;
    validateAndNotify(workPatternsPath, this.agentDir, this.notificationService);
  }

  /**
   * Get the last successful run time for a job
   */
  getLastRun(jobName: string): Date | null {
    const row = this.db
      .prepare(
        `SELECT completed_at FROM work_loop_runs
         WHERE job_name = ? AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 1`,
      )
      .get(jobName) as { completed_at: string } | undefined;

    return row ? new Date(row.completed_at) : null;
  }

  /**
   * Get all runs with optional filtering
   */
  getRuns(options?: {
    jobName?: string;
    status?: string;
    limit?: number;
    since?: Date;
  }): WorkLoopRun[] {
    let sql = "SELECT * FROM work_loop_runs WHERE 1=1";
    const params: any[] = [];

    if (options?.jobName) {
      sql += " AND job_name = ?";
      params.push(options.jobName);
    }
    if (options?.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }
    if (options?.since) {
      sql += " AND started_at >= ?";
      params.push(options.since.toISOString());
    }

    sql += " ORDER BY started_at DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as WorkLoopRun[];
  }

  /**
   * Get loaded work patterns
   */
  getPatterns(): WorkPattern[] {
    return this.patterns;
  }

  private static readonly JOB_PROMPTS: Record<
    string,
    { system: string; userTemplate: string }
  > = {
    "debrief-prep": { system: MORNING_SYSTEM, userTemplate: MORNING_USER },
    "daily-summary": { system: SUMMARY_SYSTEM, userTemplate: SUMMARY_USER },
    "weekly-review": { system: REVIEW_SYSTEM, userTemplate: REVIEW_USER },
  };

  getJobPrompts(
    jobName: string,
  ): { system: string; userTemplate: string } | null {
    return WorkLoopScheduler.JOB_PROMPTS[jobName] ?? null;
  }

  /**
   * Check if a job has run successfully today (by querying work_loop_runs).
   */
  hasRunToday(jobName: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare(
      "SELECT 1 FROM work_loop_runs WHERE job_name = ? AND started_at >= ? LIMIT 1",
    ).get(jobName, today + "T00:00:00");
    return !!row;
  }

  /**
   * Read the cached debrief output from current-state.md.
   */
  getDebriefOutput(): string | null {
    const filePath = join(this.agentDir, "notebook/operations/current-state.md");
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Manually trigger a job by name
   */
  async triggerJob(jobName: string): Promise<WorkLoopRun> {
    const pattern = this.patterns.find((p) => p.name === jobName);
    if (!pattern) {
      throw new Error(`Unknown job: ${jobName}`);
    }

    return this.runJob(pattern);
  }

  /**
   * Check for and run due jobs (called by polling interval)
   */
  private async checkDueJobs(): Promise<void> {
    if (!this.isRunning || this.isExecuting) return;

    const now = new Date();

    // Resolve timezone once per poll cycle (spec §2.2)
    const resolvedTimezone = await this.resolveTimezone();

    for (const pattern of this.patterns) {
      if (!this.isRunning) return; // Stop was called mid-loop
      const lastRun = this.getLastRun(pattern.name);
      const due = isDue(pattern.cadence, lastRun, now, resolvedTimezone);

      if (due) {
        try {
          await this.runJob(pattern);
        } catch (err) {
          console.error(
            `[WorkLoop] Failed to run ${pattern.name}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  /**
   * Resolve timezone in priority order (spec §2.2):
   * 1. properties.timezone?.value (inferred from conversation)
   * 2. preferences.timezone (from config.yaml)
   * 3. "UTC" (fallback)
   */
  private async resolveTimezone(): Promise<string> {
    try {
      const props = await readProperties(this.agentDir);
      if (props.timezone?.value) {
        // Safety: strip any parenthetical commentary from extracted value
        // e.g. "Asia/Bangkok (inferred from location)" → "Asia/Bangkok"
        const raw = props.timezone.value.split(/\s*\(/)[0].trim();
        if (isValidTimezone(raw)) return raw;
      }
    } catch {
      // Properties unavailable — continue to preferences
    }

    try {
      const prefs = loadPreferences(this.agentDir);
      if (prefs.timezone) return prefs.timezone;
    } catch {
      // Preferences unavailable — continue to fallback
    }

    return "UTC";
  }

  /**
   * Get the currently resolved timezone (for API use)
   */
  async getResolvedTimezone(): Promise<string> {
    return this.resolveTimezone();
  }

  /**
   * Run a single job — assembles context, calls Haiku, stores result
   */
  private async runJob(pattern: WorkPattern): Promise<WorkLoopRun> {
    this.isExecuting = true;

    const runId = randomUUID();
    const startedAt = new Date();

    // Create running record
    this.db
      .prepare(
        `INSERT INTO work_loop_runs (id, job_name, started_at, status)
         VALUES (?, ?, ?, 'running')`,
      )
      .run(runId, pattern.name, startedAt.toISOString());

    console.log(`[WorkLoop] Running: ${pattern.displayName}`);

    try {
      let output: string;

      switch (pattern.name) {
        case "debrief-prep":
          output = await this.handleDebriefPrep();
          break;
        case "daily-summary":
          output = await this.handleDailySummary();
          break;
        case "weekly-review":
          output = await this.handleWeeklyReview();
          break;
        case "weekly-summary":
          output = await this.handleWeeklySummary();
          break;
        case "monthly-summary":
          output = await this.handleMonthlySummary();
          break;
        default:
          throw new Error(`No handler for job: ${pattern.name}`);
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      this.db
        .prepare(
          `UPDATE work_loop_runs
           SET status = 'completed', completed_at = ?, duration_ms = ?, output = ?
           WHERE id = ?`,
        )
        .run(completedAt.toISOString(), durationMs, output, runId);

      console.log(
        `[WorkLoop] Completed: ${pattern.displayName} (${durationMs}ms, ${output.length} chars)`,
      );

      const run = this.db
        .prepare("SELECT * FROM work_loop_runs WHERE id = ?")
        .get(runId) as WorkLoopRun;

      this.isExecuting = false;
      return run;
    } catch (err) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.db
        .prepare(
          `UPDATE work_loop_runs
           SET status = 'failed', completed_at = ?, duration_ms = ?, error = ?
           WHERE id = ?`,
        )
        .run(completedAt.toISOString(), durationMs, errorMsg, runId);

      console.error(`[WorkLoop] Failed: ${pattern.displayName} — ${errorMsg}`);

      const run = this.db
        .prepare("SELECT * FROM work_loop_runs WHERE id = ?")
        .get(runId) as WorkLoopRun;

      this.isExecuting = false;
      return run;
    }
  }

  /**
   * Log an external run (e.g., fact extraction from abbreviation queue)
   */
  logExternalRun(
    jobName: string,
    durationMs: number,
    output: string,
    error?: string,
  ): void {
    const runId = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        jobName,
        now,
        now,
        error ? "failed" : "completed",
        durationMs,
        output,
        error || null,
      );
  }

  /**
   * Weekly Review - reads knowledge + reference, promotes facts, resolves conflicts
   */
  private async handleWeeklyReview(): Promise<string> {
    const notebookDir = join(this.agentDir, "notebook");
    const output = await runWeeklyReview(this.agentDir);

    // Log to daily log
    await this.appendToDailyLog(
      notebookDir,
      `- Weekly review completed (${output.length} chars)`,
    );

    return output;
  }

  /**
   * Weekly Summary -- reads last 7 daily summaries, writes compressed weekly rollup
   */
  private async handleWeeklySummary(): Promise<string> {
    const notebookDir = join(this.agentDir, "notebook");
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
      return "Quiet week -- no daily summaries found.";
    }

    const output = await runWeeklySummary(sections.join("\n\n"));

    const weeklyDir = join(notebookDir, "summaries", "weekly");
    if (!existsSync(weeklyDir)) {
      await mkdir(weeklyDir, { recursive: true });
    }

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(
      ((now.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
    );
    const weekStr = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    await writeFile(join(weeklyDir, `${weekStr}.md`), output, "utf-8");

    return output;
  }

  /**
   * Monthly Summary -- reads all weekly summaries, writes high-level monthly narrative
   */
  private async handleMonthlySummary(): Promise<string> {
    const notebookDir = join(this.agentDir, "notebook");
    const weeklyDir = join(notebookDir, "summaries", "weekly");

    if (!existsSync(weeklyDir)) {
      return "Quiet month -- no weekly summaries found.";
    }

    const files = await readdir(weeklyDir);
    const sections: string[] = [];

    for (const f of files.filter((f) => f.endsWith(".md")).sort()) {
      const content = await readFile(join(weeklyDir, f), "utf-8");
      sections.push(`### ${f.replace(".md", "")}\n${content}`);
    }

    if (sections.length === 0) {
      return "Quiet month.";
    }

    const output = await runMonthlySummary(sections.join("\n\n"));

    const monthlyDir = join(notebookDir, "summaries", "monthly");
    if (!existsSync(monthlyDir)) {
      await mkdir(monthlyDir, { recursive: true });
    }

    const monthStr = new Date().toISOString().slice(0, 7);
    await writeFile(join(monthlyDir, `${monthStr}.md`), output, "utf-8");

    return output;
  }

  /**
   * Debrief Prep — reads summary stack, produces current-state briefing
   */
  async handleDebriefPrep(): Promise<string> {
    const notebookDir = join(this.agentDir, "notebook");
    const sections: string[] = [];

    // Yesterday's daily summary
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const yesterdaySummary = join(notebookDir, "summaries", "daily", `${yesterdayStr}.md`);
    if (existsSync(yesterdaySummary)) {
      sections.push("# Yesterday's Summary\n" + await readFile(yesterdaySummary, "utf-8"));
    }

    // This week's summary (if exists)
    const weeklyDir = join(notebookDir, "summaries", "weekly");
    if (existsSync(weeklyDir)) {
      const weekFiles = (await readdir(weeklyDir)).filter((f) => f.endsWith(".md")).sort();
      if (weekFiles.length > 0) {
        const latest = await readFile(join(weeklyDir, weekFiles[weekFiles.length - 1]), "utf-8");
        sections.push("# This Week\n" + latest);
      }
    }

    // This month's summary (if exists)
    const monthlyDir = join(notebookDir, "summaries", "monthly");
    if (existsSync(monthlyDir)) {
      const monthFiles = (await readdir(monthlyDir)).filter((f) => f.endsWith(".md")).sort();
      if (monthFiles.length > 0) {
        const latest = await readFile(join(monthlyDir, monthFiles[monthFiles.length - 1]), "utf-8");
        sections.push("# This Month\n" + latest);
      }
    }

    // Today's daily log (anything logged so far today)
    const today = new Date().toISOString().split("T")[0];
    const todayLog = join(notebookDir, "daily", `${today}.md`);
    if (existsSync(todayLog)) {
      sections.push("# Today's Log So Far\n" + await readFile(todayLog, "utf-8"));
    }

    // Reference files (user-info, for context)
    const userInfo = join(notebookDir, "reference", "user-info.md");
    if (existsSync(userInfo)) {
      sections.push("# User Info\n" + await readFile(userInfo, "utf-8"));
    }

    // Properties (location, timezone, availability)
    const propsFile = join(notebookDir, "properties", "status.yaml");
    if (existsSync(propsFile)) {
      sections.push("# Current Properties\n" + await readFile(propsFile, "utf-8"));
    }

    // Staged permanent facts awaiting approval
    const stagingDir = join(notebookDir, "knowledge", "extracted");
    if (existsSync(stagingDir)) {
      const stagingFiles = (await readdir(stagingDir)).filter((f) => f.endsWith(".md"));
      if (stagingFiles.length > 0) {
        const stagingContent: string[] = [];
        for (const f of stagingFiles) {
          stagingContent.push(await readFile(join(stagingDir, f), "utf-8"));
        }
        sections.push("# Pending Knowledge (for approval)\n" + stagingContent.join("\n\n"));
      }
    }

    // Calendar context (from existing CalDAV integration, if available)
    try {
      const {
        loadCalendarConfig,
        loadCalendarCredentials,
        createCalDAVClient,
        assembleCalendarContext,
      } = await import("@my-agent/core");
      const calConfig = loadCalendarConfig(this.agentDir);
      const calCreds = loadCalendarCredentials(this.agentDir);
      if (calConfig && calCreds) {
        const calClient = await createCalDAVClient(calConfig, calCreds);
        const calContext = await assembleCalendarContext(calClient);
        if (calContext) {
          sections.push("# Calendar\n" + calContext);
        }
      }
    } catch {
      // Calendar unavailable -- continue without it
    }

    // Pending notifications (spec §5.1)
    if (this.notificationService) {
      const pending = this.notificationService.getPending();
      if (pending.length > 0) {
        const lines = pending.map((n) => {
          const msg = n.message ?? n.question ?? n.problem ?? "(no details)";
          return `- [${n.type}] ${msg}`;
        });
        sections.push("# Pending Notifications\n\n" + lines.join("\n"));
      }
    }

    let context = sections.length > 0
      ? sections.join("\n\n---\n\n")
      : "No context available.";

    // Tasks completed since last debrief
    const lastRun = this.getLastRun("debrief-prep");
    if (lastRun && this.taskManager) {
      const completedTasks = this.taskManager.getCompletedForDebrief(lastRun.toISOString());
      if (completedTasks.length > 0) {
        const taskSection = completedTasks
          .map((t) => `- **${t.title}** (completed ${t.completedAt?.toISOString().slice(0, 16)})`)
          .join("\n");
        context += `\n\n---\n\n## Tasks Completed Since Last Debrief\n\n${taskSection}`;
      }
    }

    // Clean expired facts before building the prompt (max 3 attempts)
    await cleanExpiredFacts(this.agentDir, 3);

    // Build staged facts section for prompt
    const stagingFiles = await readStagingFiles(this.agentDir);
    const stagedFactsSection = formatStagedFactsSection(stagingFiles);

    // Build stale properties section
    const properties = await readProperties(this.agentDir);
    const todayDate = new Date().toISOString().split("T")[0];
    const staleProps = detectStaleProperties(properties, todayDate);
    const stalePropertiesSection = formatStalePropertiesSection(staleProps);

    // Get model preference
    const preferences = loadPreferences(this.agentDir);
    const model = preferences.debrief.model as ModelAlias;

    const output = await runDebriefPrep(
      context,
      model,
      stagedFactsSection,
      stalePropertiesSection,
    );

    // Auto-increment attempts for all proposed facts
    for (const file of stagingFiles) {
      await incrementAllAttempts(file.filePath);
    }

    // Write to operations/current-state.md
    const opsDir = join(notebookDir, "operations");
    if (!existsSync(opsDir)) {
      await mkdir(opsDir, { recursive: true });
    }
    await writeFile(join(opsDir, "current-state.md"), output, "utf-8");

    // Log to daily log
    await this.appendToDailyLog(
      notebookDir,
      `- Debrief prep completed (${output.length} chars)`,
    );

    // Proactive outreach: alert active conversation or initiate new one (M6.9-S3)
    if (this.conversationInitiator && output) {
      try {
        const alerted = await this.conversationInitiator.alert(
          "The debrief brief has been updated. Ask the user if they'd like to go through it now, or present it naturally if starting a new conversation.",
        );
        if (!alerted) {
          await this.conversationInitiator.initiate({
            firstTurnPrompt: "[SYSTEM: The debrief brief is ready. Start a new conversation and present it naturally to the user.]",
          });
        }
      } catch (err) {
        console.error("[WorkLoop] Debrief brief initiation failed:", err);
      }
    }

    return output;
  }

  /**
   * Daily Summary -- reads yesterday's raw log, writes summary to summaries/daily/
   */
  private async handleDailySummary(): Promise<string> {
    const notebookDir = join(this.agentDir, "notebook");

    // Read yesterday's raw daily log
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

    // Write to summaries/daily/
    const summaryDir = join(notebookDir, "summaries", "daily");
    if (!existsSync(summaryDir)) {
      await mkdir(summaryDir, { recursive: true });
    }
    await writeFile(join(summaryDir, `${yesterdayStr}.md`), output, "utf-8");

    return output;
  }

  /**
   * Assemble notebook context for debrief prep:
   * reference/*, daily/{yesterday}, knowledge/*
   */
  private async assembleNotebookContext(notebookDir: string): Promise<string> {
    const sections: string[] = [];

    // Reference files
    const refDir = join(notebookDir, "reference");
    if (existsSync(refDir)) {
      const refContent = await this.readDirMarkdown(refDir);
      if (refContent) {
        sections.push("# Reference\n\n" + refContent);
      }
    }

    // Yesterday's daily log
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayFile = this.getDailyLogPath(notebookDir, yesterday);
    if (existsSync(yesterdayFile)) {
      const content = await readFile(yesterdayFile, "utf-8");
      sections.push("# Yesterday's Log\n\n" + content);
    }

    // Knowledge files
    const knowledgeDir = join(notebookDir, "knowledge");
    if (existsSync(knowledgeDir)) {
      const knowledgeContent = await this.readDirMarkdown(knowledgeDir);
      if (knowledgeContent) {
        sections.push("# Knowledge\n\n" + knowledgeContent);
      }
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * Assemble context for daily summary:
   * today's daily log + today's conversation abbreviations
   */
  private async assembleDailySummaryContext(
    notebookDir: string,
  ): Promise<string> {
    const sections: string[] = [];

    // Today's daily log
    const todayFile = this.getDailyLogPath(notebookDir, new Date());
    if (existsSync(todayFile)) {
      const content = await readFile(todayFile, "utf-8");
      sections.push("# Today's Daily Log\n\n" + content);
    }

    // Today's conversation abbreviations from the database
    const abbreviations = this.getTodayAbbreviations();
    if (abbreviations.length > 0) {
      sections.push(
        "# Today's Conversations\n\n" +
          abbreviations
            .map((a) => `## ${a.title}\n${a.abbreviation}`)
            .join("\n\n"),
      );
    }

    if (sections.length === 0) {
      return "# Daily Log — no entries today";
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * Get today's conversation abbreviations from the database
   */
  private getTodayAbbreviations(): Array<{
    title: string;
    abbreviation: string;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rows = this.db
      .prepare(
        `SELECT title, abbreviation FROM conversations
         WHERE updated >= ? AND abbreviation IS NOT NULL AND abbreviation != ''
         ORDER BY updated DESC`,
      )
      .all(todayStart.toISOString()) as Array<{
      title: string;
      abbreviation: string;
    }>;

    return rows;
  }

  /**
   * Read all .md files from a directory, concatenated
   */
  private async readDirMarkdown(dirPath: string): Promise<string> {
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

  /**
   * Get the path to a daily log file
   */
  private getDailyLogPath(notebookDir: string, date: Date): string {
    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    return join(notebookDir, "daily", `${dateStr}.md`);
  }

  /**
   * Append a line to today's daily log
   */
  private async appendToDailyLog(
    notebookDir: string,
    line: string,
  ): Promise<void> {
    const dailyDir = join(notebookDir, "daily");
    if (!existsSync(dailyDir)) {
      await mkdir(dailyDir, { recursive: true });
    }

    const logPath = this.getDailyLogPath(notebookDir, new Date());
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (!existsSync(logPath)) {
      const dateStr = new Date().toISOString().split("T")[0];
      await writeFile(
        logPath,
        `# Daily Log — ${dateStr}\n\n${timestamp} ${line}\n`,
        "utf-8",
      );
    } else {
      await appendFile(logPath, `\n${timestamp} ${line}\n`, "utf-8");
    }
  }
}
