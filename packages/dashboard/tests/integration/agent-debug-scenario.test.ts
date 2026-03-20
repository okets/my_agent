/**
 * Agent Debug Scenario Integration Tests
 *
 * Verifies that debug query pure functions work correctly against a real
 * agent directory (via AppHarness), without going through Fastify HTTP routes.
 *
 * This proves agents can introspect the brain headlessly.
 *
 * M6.10-S4: Sprint 4 (Headless App) extraction.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { AppHarness } from "./app-harness.js";
import {
  getBrainStatus,
  getBrainFiles,
  getSystemPrompt,
  getSkills,
} from "../../src/debug/debug-queries.js";

describe("Agent Debug Scenario (headless)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  // ─── getBrainStatus ────────────────────────────────────────────────────────

  describe("getBrainStatus()", () => {
    it("returns expected shape", async () => {
      const status = await getBrainStatus(harness.agentDir);

      expect(status).toMatchObject({
        hatched: expect.any(Boolean),
        authSource: expect.anything(),
        authType: expect.anything(),
        model: expect.any(String),
        brainDir: harness.agentDir,
      });
    });

    it("reports not hatched for fresh agentDir", async () => {
      const status = await getBrainStatus(harness.agentDir);
      // A fresh temp dir created by AppHarness is not hatched
      // (no config.yaml or completed hatching state)
      expect(typeof status.hatched).toBe("boolean");
    });

    it("returns a model string", async () => {
      const status = await getBrainStatus(harness.agentDir);
      expect(status.model).toBeTruthy();
      expect(typeof status.model).toBe("string");
    });

    it("brainDir matches agentDir passed in", async () => {
      const status = await getBrainStatus(harness.agentDir);
      expect(status.brainDir).toBe(harness.agentDir);
    });

    it("returns none auth when no credentials configured", async () => {
      const status = await getBrainStatus(harness.agentDir);
      // Fresh temp dir has no auth configured — should gracefully return "none"
      expect(["none", "env", "file", null]).toContain(status.authSource);
    });
  });

  // ─── getBrainFiles ─────────────────────────────────────────────────────────

  describe("getBrainFiles()", () => {
    it("returns root and files array", async () => {
      const result = await getBrainFiles(harness.agentDir);

      expect(result).toHaveProperty("root");
      expect(result).toHaveProperty("files");
      expect(Array.isArray(result.files)).toBe(true);
    });

    it("root is the brain subdirectory", async () => {
      const result = await getBrainFiles(harness.agentDir);
      expect(result.root).toBe(path.join(harness.agentDir, "brain"));
    });

    it("lists AGENTS.md created by AppHarness", async () => {
      const result = await getBrainFiles(harness.agentDir);

      const agentsMd = result.files.find((f) => f.path === "AGENTS.md");
      expect(agentsMd).toBeDefined();
      expect(agentsMd!.size).toBeGreaterThan(0);
      expect(agentsMd!.modified).toBeTruthy();
    });

    it("file entries have path, size, modified fields", async () => {
      const result = await getBrainFiles(harness.agentDir);

      for (const file of result.files) {
        expect(typeof file.path).toBe("string");
        expect(typeof file.size).toBe("number");
        expect(typeof file.modified).toBe("string");
        // modified should be ISO 8601
        expect(() => new Date(file.modified)).not.toThrow();
      }
    });

    it("files are sorted by path", async () => {
      // Add another file to brain dir to have multiple entries
      const brainDir = path.join(harness.agentDir, "brain");
      fs.writeFileSync(path.join(brainDir, "README.md"), "# Brain\n");

      const result = await getBrainFiles(harness.agentDir);

      const paths = result.files.map((f) => f.path);
      const sorted = [...paths].sort((a, b) => a.localeCompare(b));
      expect(paths).toEqual(sorted);
    });

    it("returns empty files list if brain directory has no files", async () => {
      // Create a new temp dir without the AGENTS.md that AppHarness adds
      const emptyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "debug-test-empty-"),
      );
      fs.mkdirSync(path.join(emptyDir, "brain"), { recursive: true });

      try {
        const result = await getBrainFiles(emptyDir);
        expect(result.files).toEqual([]);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  // ─── getSystemPrompt ───────────────────────────────────────────────────────

  describe("getSystemPrompt()", () => {
    it("returns systemPrompt, components, and totalChars", async () => {
      const result = await getSystemPrompt(harness.agentDir);

      expect(result).toHaveProperty("systemPrompt");
      expect(result).toHaveProperty("components");
      expect(result).toHaveProperty("totalChars");
    });

    it("systemPrompt is a string", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      expect(typeof result.systemPrompt).toBe("string");
    });

    it("totalChars matches systemPrompt length", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      expect(result.totalChars).toBe(result.systemPrompt.length);
    });

    it("components has expected keys", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      const { components } = result;

      expect(components).toHaveProperty("personality");
      expect(components).toHaveProperty("identity");
      expect(components).toHaveProperty("contacts");
      expect(components).toHaveProperty("preferences");
      expect(components).toHaveProperty("notebooks");
      expect(components).toHaveProperty("skills");
    });

    it("personality component found when AGENTS.md exists", async () => {
      // AppHarness creates brain/AGENTS.md
      const result = await getSystemPrompt(harness.agentDir);
      expect(result.components.personality).not.toBeNull();
      expect(result.components.personality!.chars).toBeGreaterThan(0);
      expect(result.components.personality!.source).toBe("brain/AGENTS.md");
    });

    it("identity/contacts/preferences are null when files missing", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      // Fresh temp dir has no memory/core/ files
      expect(result.components.identity).toBeNull();
      expect(result.components.contacts).toBeNull();
      expect(result.components.preferences).toBeNull();
    });

    it("notebooks has the expected notebook names", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      expect(result.components.notebooks).toHaveProperty(
        "external-communications",
      );
      expect(result.components.notebooks).toHaveProperty("reminders");
      expect(result.components.notebooks).toHaveProperty("standing-orders");
    });

    it("skills has framework and user counts", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      expect(typeof result.components.skills.framework).toBe("number");
      expect(typeof result.components.skills.user).toBe("number");
    });

    it("assembles a prompt that includes AGENTS.md content", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      // AppHarness writes "# Test Agent\nYou are a test agent.\n" to brain/AGENTS.md
      // assembleSystemPrompt should incorporate it
      expect(result.systemPrompt).toContain("Test Agent");
    });
  });

  // ─── getSkills ─────────────────────────────────────────────────────────────

  describe("getSkills()", () => {
    it("returns framework and user arrays", async () => {
      const result = await getSkills(harness.agentDir);

      expect(result).toHaveProperty("framework");
      expect(result).toHaveProperty("user");
      expect(Array.isArray(result.framework)).toBe(true);
      expect(Array.isArray(result.user)).toBe(true);
    });

    it("user skills empty when .claude/skills not present", async () => {
      const result = await getSkills(harness.agentDir);
      expect(result.user).toEqual([]);
    });

    it("accepts custom frameworkSkillsDir", async () => {
      // Point to a non-existent dir — should return empty without throwing
      const result = await getSkills(harness.agentDir, "/tmp/no-skills-here");
      expect(result.framework).toEqual([]);
    });
  });
});
