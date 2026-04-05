/**
 * AutomationManager — Manifest CRUD
 *
 * Creates, reads, updates, and lists automation manifests on disk
 * (as markdown files with YAML frontmatter) and indexes them into agent.db.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  Automation,
  AutomationManifest,
  CreateAutomationInput,
} from "@my-agent/core";
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";
import type { ConversationDatabase } from "../conversations/db.js";

/**
 * Convert a human-readable name to a kebab-case ID.
 */
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class AutomationManager {
  constructor(
    private automationsDir: string,
    private db: ConversationDatabase,
  ) {}

  /**
   * Create a new automation manifest file + index into agent.db.
   */
  create(input: {
    name: string;
    instructions: string;
    manifest: Partial<AutomationManifest>;
  }): Automation {
    const id = nameToId(input.name);
    const filePath = path.join(this.automationsDir, `${id}.md`);

    const manifest: AutomationManifest = {
      name: input.name,
      status: input.manifest.status ?? "active",
      trigger: input.manifest.trigger ?? [{ type: "manual" }],
      spaces: input.manifest.spaces,
      model: input.manifest.model,
      notify: input.manifest.notify ?? "debrief",
      persist_session: input.manifest.persist_session,
      autonomy: input.manifest.autonomy ?? "full",
      once: input.manifest.once,
      created: input.manifest.created ?? new Date().toISOString(),
      target_path: input.manifest.target_path,
      todos: input.manifest.todos,
      job_type: input.manifest.job_type,
    };

    // Ensure directory exists
    fs.mkdirSync(this.automationsDir, { recursive: true });

    // Write markdown file with frontmatter
    writeFrontmatter(
      filePath,
      this.manifestToFrontmatter(manifest),
      input.instructions,
    );

    const now = new Date().toISOString();
    const automation: Automation = {
      id,
      manifest,
      filePath,
      instructions: input.instructions,
      indexedAt: now,
    };

    // Index into agent.db
    this.indexAutomation(automation);

    return automation;
  }

  /**
   * Read an automation from disk (parse frontmatter + body).
   */
  read(id: string): Automation | null {
    const filePath = path.join(this.automationsDir, `${id}.md`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const { data, body } = readFrontmatter<Record<string, unknown>>(filePath);
      const manifest = this.frontmatterToManifest(data);
      const now = new Date().toISOString();

      const automation: Automation = {
        id,
        manifest,
        filePath,
        instructions: body.trim(),
        indexedAt: now,
      };

      // Re-index on read
      this.indexAutomation(automation);

      return automation;
    } catch {
      return null;
    }
  }

  /**
   * Update an automation manifest (merge frontmatter fields).
   */
  update(id: string, changes: Partial<AutomationManifest>): Automation {
    const existing = this.read(id);
    if (!existing) {
      throw new Error(`Automation not found: ${id}`);
    }

    if (existing.manifest.system) {
      throw new Error(`Cannot modify system automation: ${id}`);
    }

    const updatedManifest: AutomationManifest = {
      ...existing.manifest,
      ...changes,
    };

    writeFrontmatter(
      existing.filePath,
      this.manifestToFrontmatter(updatedManifest),
    );

    const now = new Date().toISOString();
    const automation: Automation = {
      ...existing,
      manifest: updatedManifest,
      indexedAt: now,
    };

    this.indexAutomation(automation);
    return automation;
  }

  /**
   * Disable an automation (set status: disabled).
   */
  disable(id: string): void {
    const existing = this.read(id);
    if (existing?.manifest.system) {
      throw new Error(`Cannot disable system automation: ${id}`);
    }
    if (!existing) {
      // If file doesn't exist, just update DB
      const dbRow = this.db.getAutomation(id);
      if (dbRow) {
        this.db.upsertAutomation({
          id: dbRow.id,
          name: dbRow.name,
          status: "disabled",
          triggerConfig: dbRow.triggerConfig,
          spaces: dbRow.spaces ?? undefined,
          model: dbRow.model ?? undefined,
          notify: dbRow.notify,
          persistSession: dbRow.persistSession,
          autonomy: dbRow.autonomy,
          once: dbRow.once,
          created: dbRow.created,
          indexedAt: dbRow.indexedAt,
          system: dbRow.system,
          handler: dbRow.handler ?? undefined,
        });
      }
      return;
    }

    this.update(id, { status: "disabled" });
  }

  /**
   * List automations from agent.db.
   */
  list(filter?: { status?: string; excludeSystem?: boolean }): Automation[] {
    const rows = this.db.listAutomations(filter);
    return rows.map((row) => {
      const triggerConfig = JSON.parse(row.triggerConfig);
      const manifest: AutomationManifest = {
        name: row.name,
        status: row.status as "active" | "disabled",
        trigger: triggerConfig,
        spaces: row.spaces ? JSON.parse(row.spaces) : undefined,
        model: row.model ?? undefined,
        notify: (row.notify as "immediate" | "debrief" | "none") ?? "debrief",
        persist_session: row.persistSession,
        autonomy: (row.autonomy as "full" | "cautious" | "review") ?? "full",
        once: row.once,
        created: row.created,
        handler: row.handler ?? undefined,
        system: row.system ?? false,
      };

      return {
        id: row.id,
        manifest,
        filePath: path.join(this.automationsDir, `${row.id}.md`),
        instructions: "", // Not stored in DB — read from disk if needed
        indexedAt: row.indexedAt,
      };
    });
  }

  /**
   * Get by ID from agent.db.
   */
  findById(id: string): Automation | null {
    // Read from disk to get full content including instructions
    // (list() returns DB rows with empty instructions)
    return this.read(id);
  }

  /**
   * Scan disk and sync all automation files to agent.db.
   */
  async syncAll(): Promise<number> {
    if (!fs.existsSync(this.automationsDir)) return 0;

    const files = fs
      .readdirSync(this.automationsDir)
      .filter((f) => f.endsWith(".md"));

    let count = 0;
    for (const file of files) {
      const id = path.basename(file, ".md");
      const automation = this.read(id);
      if (automation) {
        count++;
      }
    }

    // Audit: detect DB entries with no backing .md file (orphans).
    // Filesystem is source of truth — orphaned DB entries are disabled.
    const fileIds = new Set(files.map((f) => path.basename(f, ".md")));
    const dbAutomations = this.list();
    for (const automation of dbAutomations) {
      if (
        automation.manifest.status === "active" &&
        !fileIds.has(automation.id)
      ) {
        console.warn(
          `[AutomationSync] Orphan detected: "${automation.id}" is active in DB but has no .md file. Disabling.`,
        );
        this.disable(automation.id);
      }
    }

    return count;
  }

  private indexAutomation(automation: Automation): void {
    this.db.upsertAutomation({
      id: automation.id,
      name: automation.manifest.name,
      status: automation.manifest.status,
      triggerConfig: JSON.stringify(automation.manifest.trigger),
      spaces: automation.manifest.spaces
        ? JSON.stringify(automation.manifest.spaces)
        : undefined,
      model: automation.manifest.model,
      notify: automation.manifest.notify,
      persistSession: automation.manifest.persist_session,
      autonomy: automation.manifest.autonomy,
      once: automation.manifest.once,
      created: automation.manifest.created,
      indexedAt: automation.indexedAt,
      system: automation.manifest.system,
      handler: automation.manifest.handler,
    });
  }

  private manifestToFrontmatter(
    manifest: AutomationManifest,
  ): Record<string, unknown> {
    const fm: Record<string, unknown> = {
      name: manifest.name,
      status: manifest.status,
      trigger: manifest.trigger,
      created: manifest.created,
    };

    if (manifest.spaces) fm.spaces = manifest.spaces;
    if (manifest.model) fm.model = manifest.model;
    if (manifest.notify && manifest.notify !== "debrief")
      fm.notify = manifest.notify;
    if (manifest.persist_session) fm.persist_session = manifest.persist_session;
    if (manifest.autonomy && manifest.autonomy !== "full")
      fm.autonomy = manifest.autonomy;
    if (manifest.once) fm.once = manifest.once;
    if (manifest.target_path) fm.target_path = manifest.target_path;
    if (manifest.todos?.length) fm.todos = manifest.todos;
    if (manifest.job_type) fm.job_type = manifest.job_type;

    return fm;
  }

  private frontmatterToManifest(
    data: Record<string, unknown>,
  ): AutomationManifest {
    return {
      name: (data.name as string) ?? "Untitled",
      status: (data.status as "active" | "disabled") ?? "active",
      trigger: (data.trigger as AutomationManifest["trigger"]) ?? [
        { type: "manual" },
      ],
      spaces: data.spaces as string[] | undefined,
      model: data.model as string | undefined,
      notify: (data.notify as "immediate" | "debrief" | "none") ?? "debrief",
      persist_session: (data.persist_session as boolean) ?? false,
      autonomy: (data.autonomy as "full" | "cautious" | "review") ?? "full",
      once: (data.once as boolean) ?? false,
      created: (data.created as string) ?? new Date().toISOString(),
      system: (data.system as boolean) ?? undefined,
      handler: (data.handler as string) ?? undefined,
      target_path: (data.target_path as string) ?? undefined,
      todos: data.todos as Array<{ text: string }> | undefined,
      job_type: data.job_type as AutomationManifest["job_type"],
    };
  }
}
