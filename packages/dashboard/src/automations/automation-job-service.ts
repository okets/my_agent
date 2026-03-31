/**
 * AutomationJobService — JSONL job lifecycle
 *
 * Each automation has a per-automation JSONL file: `.my_agent/automations/{automationId}.jsonl`
 * Each line is a complete JSON object (not a diff). The JSONL file is the source of truth.
 * agent.db `jobs` table is derived for fast queries.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Job, JobStatus } from "@my-agent/core";
import type { ConversationDatabase } from "../conversations/db.js";

export class AutomationJobService {
  constructor(
    private automationsDir: string,
    private db: ConversationDatabase,
  ) {}

  /**
   * Create a new job. Appends to {automationId}.jsonl, inserts into agent.db, creates run dir.
   */
  createJob(automationId: string, context?: Record<string, unknown>): Job {
    const id = `job-${randomUUID()}`;
    const now = new Date().toISOString();
    const runDir = this.createRunDir(automationId, id);

    const job: Job = {
      id,
      automationId,
      status: "pending",
      created: now,
      context,
      run_dir: runDir,
    };

    // Append to JSONL (source of truth)
    this.appendToJsonl(automationId, job);

    // Insert into agent.db (derived index)
    this.db.upsertJob({
      id: job.id,
      automationId: job.automationId,
      status: job.status,
      created: job.created,
      context: job.context ? JSON.stringify(job.context) : undefined,
      runDir: job.run_dir,
      deliverablePath: job.deliverablePath,
      screenshotIds: job.screenshotIds
        ? JSON.stringify(job.screenshotIds)
        : undefined,
    });

    return job;
  }

  /**
   * Update job status + fields. Reads JSONL, replaces matching line, writes back, updates agent.db.
   */
  updateJob(
    jobId: string,
    updates: Partial<
      Pick<Job, "status" | "completed" | "summary" | "sdk_session_id" | "deliverablePath" | "screenshotIds">
    >,
  ): Job {
    // Get current job from DB for automationId lookup
    const dbJob = this.db.getJob(jobId);
    if (!dbJob) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const automationId = dbJob.automationId;
    const jsonlPath = this.getJsonlPath(automationId);

    // Read JSONL, find and update the matching line
    // Safe: AutomationProcessor enforces one-job-per-automation concurrency,
    // so concurrent writes to the same JSONL are prevented by the semaphore.
    const lines = this.readJsonlLines(jsonlPath);
    let result: Job | null = null;

    const newLines = lines.map((line) => {
      let job: Job;
      try {
        job = JSON.parse(line) as Job;
      } catch {
        // Skip corrupted JSONL lines (truncated write, disk error)
        return line;
      }
      if (job.id === jobId) {
        const merged = { ...job, ...updates };
        result = merged;
        return JSON.stringify(merged);
      }
      return line;
    });

    if (!result) {
      throw new Error(
        `Job ${jobId} not found in JSONL for automation ${automationId}`,
      );
    }

    const updatedJob: Job = result;

    // Write back JSONL
    fs.writeFileSync(jsonlPath, newLines.join("\n") + "\n", "utf-8");

    // Update agent.db
    this.db.upsertJob({
      id: updatedJob.id,
      automationId: updatedJob.automationId,
      status: updatedJob.status,
      created: updatedJob.created,
      completed: updatedJob.completed,
      summary: updatedJob.summary,
      context: updatedJob.context
        ? JSON.stringify(updatedJob.context)
        : undefined,
      sdkSessionId: updatedJob.sdk_session_id,
      runDir: updatedJob.run_dir,
      deliverablePath: updatedJob.deliverablePath,
      screenshotIds: updatedJob.screenshotIds
        ? JSON.stringify(updatedJob.screenshotIds)
        : undefined,
    });

    return updatedJob;
  }

  /**
   * Query jobs from agent.db (fast).
   */
  listJobs(filter?: {
    automationId?: string;
    status?: string;
    since?: string;
    limit?: number;
  }): Job[] {
    const rows = this.db.listJobs(filter);
    return rows.map((row) => this.dbRowToJob(row));
  }

  /**
   * Get single job by ID.
   */
  getJob(jobId: string): Job | null {
    const row = this.db.getJob(jobId);
    if (!row) return null;
    return this.dbRowToJob(row);
  }

  /**
   * Get the JSONL file path for an automation.
   */
  getJsonlPath(automationId: string): string {
    return path.join(this.automationsDir, `${automationId}.jsonl`);
  }

  /**
   * Re-index all JSONL files into agent.db (for rebuild from disk).
   */
  async reindexAll(): Promise<number> {
    const jsonlFiles = fs
      .readdirSync(this.automationsDir)
      .filter((f) => f.endsWith(".jsonl"));

    let count = 0;
    for (const file of jsonlFiles) {
      const filePath = path.join(this.automationsDir, file);
      const lines = this.readJsonlLines(filePath);

      for (const line of lines) {
        let job: Job;
        try {
          job = JSON.parse(line) as Job;
        } catch {
          // Skip corrupted JSONL lines during reindex
          continue;
        }
        this.db.upsertJob({
          id: job.id,
          automationId: job.automationId,
          status: job.status,
          created: job.created,
          completed: job.completed,
          summary: job.summary,
          context: job.context ? JSON.stringify(job.context) : undefined,
          sdkSessionId: job.sdk_session_id,
          runDir: job.run_dir,
          deliverablePath: job.deliverablePath,
          screenshotIds: job.screenshotIds
            ? JSON.stringify(job.screenshotIds)
            : undefined,
        });
        count++;
      }
    }

    return count;
  }

  /**
   * Prune expired run directories. Keeps dirs for jobs with status needs_review.
   */
  pruneExpiredRunDirs(retentionDays = 7): number {
    const runsDir = path.join(this.automationsDir, ".runs");
    if (!fs.existsSync(runsDir)) return 0;

    let pruned = 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    let automationDirs: string[];
    try {
      automationDirs = fs.readdirSync(runsDir);
    } catch {
      return 0;
    }

    for (const automationDir of automationDirs) {
      const automationRunsPath = path.join(runsDir, automationDir);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(automationRunsPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let jobDirs: string[];
      try {
        jobDirs = fs.readdirSync(automationRunsPath);
      } catch {
        continue;
      }

      for (const jobDir of jobDirs) {
        const jobRunPath = path.join(automationRunsPath, jobDir);
        let jobStat: fs.Stats;
        try {
          jobStat = fs.statSync(jobRunPath);
        } catch {
          continue;
        }
        if (!jobStat.isDirectory()) continue;
        if (jobStat.mtimeMs > cutoff) continue;

        // Check if job is needs_review -- don't prune
        const job = this.getJob(jobDir);
        if (job?.status === "needs_review") continue;

        // Check if automation has once: true -- keep indefinitely
        const automation = this.db.getAutomation(automationDir);
        if (automation?.once) continue;

        try {
          fs.rmSync(jobRunPath, { recursive: true });
          pruned++;
        } catch {
          // Skip if can't remove
        }
      }

      // Clean up empty automation run dirs
      try {
        const remaining = fs.readdirSync(automationRunsPath);
        if (remaining.length === 0) {
          fs.rmdirSync(automationRunsPath);
        }
      } catch {
        // Ignore
      }
    }
    return pruned;
  }

  /**
   * Store SDK session ID in sidecar file: .sessions/{automationId}.json
   */
  storeSessionId(automationId: string, jobId: string, sessionId: string): void {
    const sessionsDir = path.join(this.automationsDir, ".sessions");
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    const sidecarPath = path.join(sessionsDir, `${automationId}.json`);
    let data: Record<string, string> = {};
    if (fs.existsSync(sidecarPath)) {
      try {
        data = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
      } catch {
        // Corrupted file, start fresh
      }
    }
    data[jobId] = sessionId;
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify(data, null, 2) + "\n",
      "utf-8",
    );
  }

  /**
   * Read SDK session ID from sidecar file.
   */
  getSessionId(automationId: string, jobId: string): string | null {
    const sidecarPath = path.join(
      this.automationsDir,
      ".sessions",
      `${automationId}.json`,
    );
    if (!fs.existsSync(sidecarPath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
      return data[jobId] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Create ephemeral run directory.
   */
  private createRunDir(automationId: string, jobId: string): string {
    const runDir = path.join(this.automationsDir, ".runs", automationId, jobId);
    fs.mkdirSync(runDir, { recursive: true });

    const automationName = automationId; // Will be enriched by caller if needed
    const claudeMd = [
      `# Automation Run: ${automationName}`,
      `Job ID: ${jobId}`,
      `Automation: ${automationId}`,
      `Started: ${new Date().toISOString()}`,
      "",
      "Use this directory for scratch files. Write status-report.md when complete.",
    ].join("\n");

    fs.writeFileSync(path.join(runDir, "CLAUDE.md"), claudeMd, "utf-8");
    return runDir;
  }

  private appendToJsonl(automationId: string, job: Job): void {
    const jsonlPath = this.getJsonlPath(automationId);
    const line = JSON.stringify(job) + "\n";
    fs.appendFileSync(jsonlPath, line, "utf-8");
  }

  private readJsonlLines(filePath: string): string[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n");
  }

  private dbRowToJob(row: {
    id: string;
    automationId: string;
    status: string;
    created: string;
    completed: string | null;
    summary: string | null;
    context: string | null;
    sdkSessionId: string | null;
    runDir: string | null;
    deliverablePath: string | null;
    screenshotIds: string | null;
  }): Job {
    return {
      id: row.id,
      automationId: row.automationId,
      status: row.status as JobStatus,
      created: row.created,
      completed: row.completed ?? undefined,
      summary: row.summary ?? undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      sdk_session_id: row.sdkSessionId ?? undefined,
      run_dir: row.runDir ?? undefined,
      deliverablePath: row.deliverablePath ?? undefined,
      screenshotIds: row.screenshotIds ? JSON.parse(row.screenshotIds) : undefined,
    };
  }
}
