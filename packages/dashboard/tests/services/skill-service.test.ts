import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SkillService } from "../../src/services/skill-service.js";

const TEST_DIR = join(import.meta.dirname, "tmp-skill-service-test");
const SKILLS_DIR = join(TEST_DIR, ".claude", "skills");

function createTestSkill(
  name: string,
  origin: string = "user",
  disabled: boolean = false,
) {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const dm = disabled ? "\ndisable-model-invocation: true" : "";
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}\norigin: ${origin}${dm}\n---\n\nContent for ${name}`,
  );
}

describe("SkillService", () => {
  let service: SkillService;

  beforeEach(() => {
    mkdirSync(SKILLS_DIR, { recursive: true });
    service = new SkillService(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("list", () => {
    it("returns empty array when no skills exist", () => {
      const result = service.list();
      expect(result).toEqual([]);
    });

    it("lists all skills with metadata", () => {
      createTestSkill("my-skill", "user");
      createTestSkill("brainstorming", "curated");
      const result = service.list();
      expect(result).toHaveLength(2);
      expect(result.find((s) => s.name === "my-skill")?.origin).toBe("user");
      expect(result.find((s) => s.name === "brainstorming")?.origin).toBe(
        "curated",
      );
    });

    it("includes disabled state in listing", () => {
      createTestSkill("active-skill", "user", false);
      createTestSkill("disabled-skill", "user", true);
      const result = service.list();
      expect(result.find((s) => s.name === "active-skill")?.disabled).toBe(
        false,
      );
      expect(result.find((s) => s.name === "disabled-skill")?.disabled).toBe(
        true,
      );
    });
  });

  describe("get", () => {
    it("returns skill content and metadata", () => {
      createTestSkill("my-skill");
      const result = service.get("my-skill");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("my-skill");
      expect(result!.origin).toBe("user");
      expect(result!.content).toContain("Content for my-skill");
    });

    it("returns null for non-existent skill", () => {
      expect(service.get("nope")).toBeNull();
    });
  });

  describe("toggle", () => {
    it("disables an enabled user skill", () => {
      createTestSkill("my-skill", "user", false);
      const result = service.toggle("my-skill");
      expect(result.disabled).toBe(true);
      // Verify file was updated
      const skill = service.get("my-skill");
      expect(skill!.disabled).toBe(true);
    });

    it("enables a disabled user skill", () => {
      createTestSkill("my-skill", "user", true);
      const result = service.toggle("my-skill");
      expect(result.disabled).toBe(false);
    });

    it("rejects toggling system skills", () => {
      createTestSkill("system-skill", "system");
      expect(() => service.toggle("system-skill")).toThrow(/system/);
    });

    it("rejects toggling curated skills", () => {
      createTestSkill("curated-skill", "curated");
      expect(() => service.toggle("curated-skill")).toThrow(/curated/);
    });
  });

  describe("delete", () => {
    it("deletes a user skill", () => {
      createTestSkill("my-skill", "user");
      service.delete("my-skill");
      expect(service.get("my-skill")).toBeNull();
    });

    it("rejects deleting system skills", () => {
      createTestSkill("sys", "system");
      expect(() => service.delete("sys")).toThrow(/system/);
    });
  });

  describe("update", () => {
    it("updates description and body of user skill", () => {
      createTestSkill("my-skill", "user");
      const result = service.update("my-skill", "New desc", "New body content");
      expect(result.description).toBe("New desc");
      expect(result.body).toContain("New body content");
    });

    it("preserves disabled state on update", () => {
      createTestSkill("my-skill", "user", true);
      const result = service.update("my-skill", "Updated", "Updated body");
      expect(result.disabled).toBe(true);
    });

    it("rejects updating system skills", () => {
      createTestSkill("sys", "system");
      expect(() => service.update("sys", "x", "y")).toThrow(/system/);
    });

    it("rejects identity-override content", () => {
      createTestSkill("my-skill", "user");
      expect(() =>
        service.update("my-skill", "desc", "Your name is Bob"),
      ).toThrow(/identity/);
    });
  });

  describe("isEditable", () => {
    it("returns true for user skills", () => {
      createTestSkill("my-skill", "user");
      expect(service.isEditable("my-skill")).toBe(true);
    });

    it("returns false for system skills", () => {
      createTestSkill("sys-skill", "system");
      expect(service.isEditable("sys-skill")).toBe(false);
    });

    it("returns false for curated skills", () => {
      createTestSkill("cur-skill", "curated");
      expect(service.isEditable("cur-skill")).toBe(false);
    });
  });
});
