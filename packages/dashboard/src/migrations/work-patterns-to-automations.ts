/**
 * Migration: work-patterns.md → automation manifests
 *
 * If `notebook/config/work-patterns.md` exists but `automations/` is empty
 * or missing, create automation manifests from the work-patterns config.
 * This ensures existing hatched agents keep their scheduled jobs after upgrade.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Convert work-patterns cadence string to cron expression */
function cadenceToCron(cadence: string): string {
  const parts = cadence.toLowerCase().split(":");

  if (parts[0] === "daily" && parts.length === 3) {
    const hour = parseInt(parts[1], 10);
    const minute = parseInt(parts[2], 10);
    return `${minute} ${hour} * * *`;
  }

  if (parts[0] === "weekly" && parts.length === 4) {
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const day = dayMap[parts[1]] ?? 0;
    const hour = parseInt(parts[2], 10);
    const minute = parseInt(parts[3], 10);
    return `${minute} ${hour} * * ${day}`;
  }

  if (parts[0] === "monthly" && parts.length === 3) {
    const hour = parseInt(parts[1], 10);
    const minute = parseInt(parts[2], 10);
    return `${minute} ${hour} 1 * *`;
  }

  // Fallback: assume it's already a cron expression or default daily 8am
  return cadence.includes(" ") ? cadence : "0 8 * * *";
}

/** Known handler mappings — which jobs are system vs user */
const HANDLER_CONFIG: Record<string, { system: boolean; defaultStatus: string }> = {
  "debrief-prep": { system: false, defaultStatus: "active" },
  "daily-summary": { system: true, defaultStatus: "active" },
  "weekly-review": { system: true, defaultStatus: "disabled" },
  "weekly-summary": { system: true, defaultStatus: "disabled" },
  "monthly-summary": { system: true, defaultStatus: "disabled" },
};

function toDisplayName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Migrate work-patterns.md jobs to automation manifests.
 *
 * @returns Number of manifests created
 */
export function migrateWorkPatternsToAutomations(agentDir: string): number {
  const workPatternsPath = join(agentDir, "notebook", "config", "work-patterns.md");
  const automationsDir = join(agentDir, "automations");

  // Only migrate if work-patterns exists
  if (!existsSync(workPatternsPath)) return 0;

  // If automations directory already has .md files, skip migration
  if (existsSync(automationsDir)) {
    const existing = readdirSync(automationsDir).filter((f) => f.endsWith(".md"));
    if (existing.length > 0) return 0;
  }

  // Also check if templates are available as fallback
  const templatesDir = join(__dirname, "..", "hatching", "templates");

  // Parse work-patterns frontmatter manually (avoid importing work-patterns.ts which will be deleted)
  let jobs: Record<string, { cadence: string; model?: string }> = {};
  try {
    const content = readFileSync(workPatternsPath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const data = parseYaml(fmMatch[1]) as { jobs?: Record<string, { cadence: string; model?: string }> };
      if (data?.jobs) {
        jobs = data.jobs;
      }
    }
  } catch (err) {
    console.warn("[Migration] Failed to parse work-patterns.md:", err instanceof Error ? err.message : String(err));
    return 0;
  }

  if (Object.keys(jobs).length === 0) {
    // Fall back to copying templates directly
    return copyTemplates(agentDir, templatesDir);
  }

  mkdirSync(automationsDir, { recursive: true });
  const createdDate = new Date().toISOString().split("T")[0];
  let count = 0;

  for (const [name, config] of Object.entries(jobs)) {
    const handlerConfig = HANDLER_CONFIG[name];
    const isSystem = handlerConfig?.system ?? false;
    const status = handlerConfig?.defaultStatus ?? "active";
    const cron = cadenceToCron(config.cadence);
    const model = config.model ?? "haiku";
    const displayName = toDisplayName(name);

    // Determine output filename
    const filename = isSystem ? `system-${name}.md` : `${name === "debrief-prep" ? "debrief" : name}.md`;
    const outputPath = join(automationsDir, filename);

    if (existsSync(outputPath)) continue;

    const systemLine = isSystem ? `\nsystem: true` : "";
    const manifest = `---
name: ${displayName}
status: ${status}${systemLine}
trigger:
  - type: schedule
    cron: "${cron}"
handler: ${name}
model: ${model}
notify: ${isSystem ? "none" : "immediate"}
autonomy: full
once: false
created: "${createdDate}"
---

# ${displayName}

Migrated from work-patterns.md on ${createdDate}.
`;

    writeFileSync(outputPath, manifest, "utf-8");
    count++;
    console.log(`[Migration] Created automation manifest: ${filename}`);
  }

  // Also create any system automations not in work-patterns
  for (const [name, cfg] of Object.entries(HANDLER_CONFIG)) {
    if (!cfg.system) continue;
    if (jobs[name]) continue; // Already handled above

    const filename = `system-${name}.md`;
    const outputPath = join(automationsDir, filename);
    if (existsSync(outputPath)) continue;

    // Try to copy from template
    const templatePath = join(templatesDir, filename);
    if (existsSync(templatePath)) {
      let content = readFileSync(templatePath, "utf-8");
      content = content.replace(/\{\{created_date\}\}/g, createdDate);
      writeFileSync(outputPath, content, "utf-8");
      count++;
      console.log(`[Migration] Created automation manifest from template: ${filename}`);
    }
  }

  if (count > 0) {
    console.log(`[Migration] Migrated ${count} work-patterns job(s) to automation manifests`);
  }

  return count;
}

/** Copy all templates to automations dir as fallback */
function copyTemplates(agentDir: string, templatesDir: string): number {
  if (!existsSync(templatesDir)) return 0;

  const automationsDir = join(agentDir, "automations");
  mkdirSync(automationsDir, { recursive: true });

  const createdDate = new Date().toISOString().split("T")[0];
  const templateFiles = readdirSync(templatesDir).filter((f) => f.endsWith(".md"));
  let count = 0;

  for (const file of templateFiles) {
    const outputName = file.replace("-automation", "");
    const outputPath = join(automationsDir, outputName);
    if (existsSync(outputPath)) continue;

    let content = readFileSync(join(templatesDir, file), "utf-8");
    content = content.replace(/\{\{created_date\}\}/g, createdDate);
    writeFileSync(outputPath, content, "utf-8");
    count++;
  }

  return count;
}
