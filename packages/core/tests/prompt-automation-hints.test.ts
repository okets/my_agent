import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadAutomationHints } from "../src/prompt.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as yamlStringify } from "yaml";

function writeAutomation(
  dir: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  body: string = "",
): void {
  const yaml = yamlStringify(frontmatter);
  const content = `---\n${yaml}---\n${body ? "\n" + body : ""}`;
  writeFileSync(join(dir, filename), content, "utf-8");
}

describe("loadAutomationHints", () => {
  let agentDir: string;
  let automationsDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "auto-hints-"));
    automationsDir = join(agentDir, "automations");
  });

  it("returns null when automations directory does not exist", async () => {
    const result = await loadAutomationHints(agentDir);
    expect(result).toBeNull();
  });

  it("returns null when automations directory is empty", async () => {
    mkdirSync(automationsDir, { recursive: true });
    const result = await loadAutomationHints(agentDir);
    expect(result).toBeNull();
  });

  it("formats active automations", async () => {
    mkdirSync(automationsDir, { recursive: true });
    writeAutomation(automationsDir, "daily-report.md", {
      name: "Daily Report",
      status: "active",
      trigger: [{ type: "schedule", cron: "0 9 * * *" }],
    });

    const result = await loadAutomationHints(agentDir);
    expect(result).not.toBeNull();
    expect(result).toContain("## Active Automations");
    expect(result).toContain("Daily Report");
    expect(result).toContain("schedule");
  });

  it("skips disabled automations", async () => {
    mkdirSync(automationsDir, { recursive: true });
    writeAutomation(automationsDir, "active-one.md", {
      name: "Active One",
      status: "active",
      trigger: [{ type: "manual" }],
    });
    writeAutomation(automationsDir, "disabled-one.md", {
      name: "Disabled One",
      status: "disabled",
      trigger: [{ type: "manual" }],
    });

    const result = await loadAutomationHints(agentDir);
    expect(result).toContain("Active One");
    expect(result).not.toContain("Disabled One");
  });

  it("includes channel hints", async () => {
    mkdirSync(automationsDir, { recursive: true });
    writeAutomation(automationsDir, "invoice-filer.md", {
      name: "Invoice Filer",
      status: "active",
      trigger: [{ type: "channel", hint: "invoice,receipt" }],
    });

    const result = await loadAutomationHints(agentDir);
    expect(result).toContain("hints: invoice,receipt");
  });

  it("includes spaces", async () => {
    mkdirSync(automationsDir, { recursive: true });
    writeAutomation(automationsDir, "backup.md", {
      name: "Backup",
      status: "active",
      trigger: [{ type: "schedule", cron: "0 2 * * *" }],
      spaces: ["data-store"],
    });

    const result = await loadAutomationHints(agentDir);
    expect(result).toContain("-> data-store");
  });

  it("returns pull-model message for 50+ automations", async () => {
    mkdirSync(automationsDir, { recursive: true });
    for (let i = 0; i < 51; i++) {
      writeAutomation(automationsDir, `auto-${i.toString().padStart(3, "0")}.md`, {
        name: `Auto ${i}`,
        status: "active",
        trigger: [{ type: "manual" }],
      });
    }

    const result = await loadAutomationHints(agentDir);
    expect(result).toContain("50+ automations");
    expect(result).toContain("list_automations");
  });

  it("skips malformed files gracefully", async () => {
    mkdirSync(automationsDir, { recursive: true });
    writeFileSync(join(automationsDir, "broken.md"), "not yaml frontmatter", "utf-8");
    writeAutomation(automationsDir, "good.md", {
      name: "Good One",
      status: "active",
      trigger: [{ type: "manual" }],
    });

    const result = await loadAutomationHints(agentDir);
    expect(result).toContain("Good One");
  });

  it("returns null when all automations are disabled", async () => {
    mkdirSync(automationsDir, { recursive: true });
    writeAutomation(automationsDir, "disabled.md", {
      name: "Disabled",
      status: "disabled",
      trigger: [{ type: "manual" }],
    });

    const result = await loadAutomationHints(agentDir);
    expect(result).toBeNull();
  });
});
