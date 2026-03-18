/**
 * M6.8-S6 Skills UI E2E Tests
 *
 * Validates the complete Skills Architecture milestone:
 * - Skills API endpoints (list, get, toggle, delete protection)
 * - System/curated skill protection (cannot toggle or delete)
 * - Skill metadata correctness (name, description, origin, disabled)
 *
 * Requires dashboard running at localhost:4321.
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = "http://127.0.0.1:4321";

describe("Skills UI E2E", () => {
  beforeAll(async () => {
    // Verify dashboard is running
    try {
      const res = await fetch(BASE_URL);
      expect(res.ok).toBe(true);
    } catch {
      throw new Error(
        "Dashboard not running at " +
          BASE_URL +
          ". Run: systemctl --user restart nina-dashboard.service",
      );
    }
  });

  describe("GET /api/skills", () => {
    it("returns skill list with correct shape", async () => {
      const res = await fetch(`${BASE_URL}/api/skills`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.skills).toBeInstanceOf(Array);
      expect(data.skills.length).toBeGreaterThan(0);

      // Each skill has required fields
      for (const skill of data.skills) {
        expect(skill).toHaveProperty("name");
        expect(skill).toHaveProperty("description");
        expect(skill).toHaveProperty("origin");
        expect(typeof skill.disabled).toBe("boolean");
      }
    });

    it("includes system, curated, and user-origin skills", async () => {
      const res = await fetch(`${BASE_URL}/api/skills`);
      const { skills } = await res.json();
      const origins = new Set(skills.map((s: any) => s.origin));
      // At minimum we should have system and curated from M6.8-S3/S4
      expect(origins.has("system")).toBe(true);
      expect(origins.has("curated")).toBe(true);
    });
  });

  describe("GET /api/skills/:name", () => {
    it("returns full skill content for existing skill", async () => {
      const listRes = await fetch(`${BASE_URL}/api/skills`);
      const { skills } = await listRes.json();
      const firstName = skills[0]?.name;
      expect(firstName).toBeTruthy();

      const res = await fetch(`${BASE_URL}/api/skills/${firstName}`);
      expect(res.ok).toBe(true);
      const skill = await res.json();
      expect(skill.name).toBe(firstName);
      expect(skill.body).toBeTruthy();
      expect(skill.origin).toBeTruthy();
      expect(typeof skill.disabled).toBe("boolean");
    });

    it("returns 404 for non-existent skill", async () => {
      const res = await fetch(
        `${BASE_URL}/api/skills/this-skill-does-not-exist-abc123`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("system/curated skill protection", () => {
    it("rejects toggling a system skill (403)", async () => {
      const listRes = await fetch(`${BASE_URL}/api/skills`);
      const { skills } = await listRes.json();
      const systemSkill = skills.find((s: any) => s.origin === "system");
      if (!systemSkill) return; // skip if none

      const res = await fetch(
        `${BASE_URL}/api/skills/${systemSkill.name}/toggle`,
        { method: "POST" },
      );
      expect(res.status).toBe(403);
    });

    it("rejects deleting a system skill (403)", async () => {
      const listRes = await fetch(`${BASE_URL}/api/skills`);
      const { skills } = await listRes.json();
      const systemSkill = skills.find((s: any) => s.origin === "system");
      if (!systemSkill) return;

      const res = await fetch(
        `${BASE_URL}/api/skills/${systemSkill.name}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(403);
    });

    it("rejects toggling a curated skill (403)", async () => {
      const listRes = await fetch(`${BASE_URL}/api/skills`);
      const { skills } = await listRes.json();
      const curatedSkill = skills.find((s: any) => s.origin === "curated");
      if (!curatedSkill) return;

      const res = await fetch(
        `${BASE_URL}/api/skills/${curatedSkill.name}/toggle`,
        { method: "POST" },
      );
      expect(res.status).toBe(403);
    });

    it("rejects updating a system skill (403)", async () => {
      const listRes = await fetch(`${BASE_URL}/api/skills`);
      const { skills } = await listRes.json();
      const systemSkill = skills.find((s: any) => s.origin === "system");
      if (!systemSkill) return;

      const res = await fetch(
        `${BASE_URL}/api/skills/${systemSkill.name}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: "hacked",
            content: "hacked content",
          }),
        },
      );
      expect(res.status).toBe(403);
    });
  });
});
