import fs from "node:fs";
import path from "node:path";

export interface PersistentNotification {
  job_id: string;
  automation_id: string;
  type:
    | "job_completed"
    | "job_failed"
    | "job_interrupted"
    | "job_needs_review"
    | "capability_degraded"
    | "capability_invalid";
  summary: string;
  todos_completed?: number;
  todos_total?: number;
  incomplete_items?: string[];
  created: string;
  delivery_attempts: number;
  resumable?: boolean;
  /** Internal — filename in pending/ or delivered/. Not persisted to disk. */
  _filename?: string;
}

export class PersistentNotificationQueue {
  private pendingDir: string;
  private deliveredDir: string;

  constructor(baseDir: string) {
    this.pendingDir = path.join(baseDir, "pending");
    this.deliveredDir = path.join(baseDir, "delivered");
    fs.mkdirSync(this.pendingDir, { recursive: true });
    fs.mkdirSync(this.deliveredDir, { recursive: true });
  }

  enqueue(notification: Omit<PersistentNotification, "_filename">): void {
    const filename = `${Date.now()}-${notification.job_id}.json`;
    const filePath = path.join(this.pendingDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(notification, null, 2));
  }

  listPending(): PersistentNotification[] {
    const files = fs
      .readdirSync(this.pendingDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    return files.map((f) => {
      const data = JSON.parse(
        fs.readFileSync(path.join(this.pendingDir, f), "utf-8"),
      );
      data._filename = f;
      return data as PersistentNotification;
    });
  }

  markDelivered(filename: string): void {
    const src = path.join(this.pendingDir, filename);
    const dst = path.join(this.deliveredDir, filename);
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  }

  incrementAttempts(filename: string): void {
    const filePath = path.join(this.pendingDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data.delivery_attempts = (data.delivery_attempts || 0) + 1;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // File may have been deleted between listPending() and incrementAttempts()
    }
  }
}
