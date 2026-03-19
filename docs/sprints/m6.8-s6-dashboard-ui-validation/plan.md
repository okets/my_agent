# M6.8-S6 Dashboard UI + Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Skills section to the notebook UI (browse, view, edit, delete, toggle) and run full E2E validation of the complete M6.8 system.

**Architecture:** Extract skill file I/O from `skill-server.ts` MCP handlers into a `SkillService` class. REST routes wrap SkillService. MCP handlers call SkillService. Dashboard UI gets a 5th "Skills" tab in the notebook widget + a Skills section in the notebook browser. SkillService becomes `app.skills` in M6.10 headless extraction.

**Tech Stack:** TypeScript, Fastify (REST), Alpine.js (UI), Vitest (unit tests), Playwright (E2E)

**Design spec:** `docs/superpowers/specs/2026-03-15-skills-architecture-design.md` (Section: "Dashboard UI > Notebook Skills Section")

**Baseline:** 682 tests (171 core, 511 dashboard), 0 failures

**Note on search:** The spec mentions "search skills (indexed by notebook's existing search)". The existing memory search (`/api/memory/search`) indexes notebook files. Skills live in `.claude/skills/`, not `notebook/`. Search integration requires extending the search service's indexing scope — this is out of scope for S6 (which focuses on the notebook UI section) and should be a follow-up task.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/dashboard/src/services/skill-service.ts` | SkillService class — list, get, update, delete, toggle. All file I/O. |
| Create | `packages/dashboard/src/routes/skills.ts` | REST routes: `GET /api/skills`, `GET /api/skills/:name`, `PUT /api/skills/:name`, `DELETE /api/skills/:name`, `POST /api/skills/:name/toggle` |
| Modify | `packages/dashboard/src/mcp/skill-server.ts` | Refactor handlers to use SkillService instead of direct file I/O |
| Modify | `packages/dashboard/src/server.ts` | Register skills routes, add SkillService to Fastify decorators |
| Modify | `packages/dashboard/public/js/app.js` | Add skills state, `loadSkills()`, `toggleSkill()`, `deleteSkill()`, skills tab logic |
| Modify | `packages/dashboard/public/index.html` | Skills tab in notebook widget (desktop + mobile), skills section in notebook browser, skill detail view |
| Create | `packages/dashboard/tests/services/skill-service.test.ts` | SkillService unit tests |
| Create | `packages/dashboard/tests/routes/skills-routes.test.ts` | REST route tests |
| Create | `packages/dashboard/tests/e2e/skills-ui.test.ts` | Playwright E2E: browse, view, toggle, edit, delete |

---

### Task 1: SkillService — Extract Shared Logic

**Files:**
- Create: `packages/dashboard/src/services/skill-service.ts`
- Create: `packages/dashboard/tests/services/skill-service.test.ts`

The SkillService encapsulates all skill file operations. It reuses `validateSkillName`, `validateSkillContent`, and `parseSkillFrontmatter` from `skill-validation.ts`. The MCP handlers and REST routes both call this service.

- [ ] **Step 1: Write SkillService tests**

```typescript
// packages/dashboard/tests/services/skill-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SkillService } from "../../src/services/skill-service.js";

const TEST_DIR = join(import.meta.dirname, "tmp-skill-service-test");
const SKILLS_DIR = join(TEST_DIR, ".claude", "skills");

function createTestSkill(name: string, origin: string = "user", disabled: boolean = false) {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const dm = disabled ? "\ndisable-model-invocation: true" : "";
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}\norigin: ${origin}${dm}\n---\n\nContent for ${name}`
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
      expect(result.find(s => s.name === "my-skill")?.origin).toBe("user");
      expect(result.find(s => s.name === "brainstorming")?.origin).toBe("curated");
    });

    it("includes disabled state in listing", () => {
      createTestSkill("active-skill", "user", false);
      createTestSkill("disabled-skill", "user", true);
      const result = service.list();
      expect(result.find(s => s.name === "active-skill")?.disabled).toBe(false);
      expect(result.find(s => s.name === "disabled-skill")?.disabled).toBe(true);
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
      expect(() => service.update("my-skill", "desc", "Your name is Bob")).toThrow(/identity/);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/services/skill-service.test.ts`
Expected: FAIL — `SkillService` not found

- [ ] **Step 3: Implement SkillService**

```typescript
// packages/dashboard/src/services/skill-service.ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  validateSkillName,
  validateSkillContent,
  PROTECTED_ORIGINS,
} from "../mcp/skill-validation.js";

export interface SkillMeta {
  name: string;
  description: string;
  origin: string;
  disabled: boolean;
}

export interface SkillFull extends SkillMeta {
  content: string;      // Full raw file content (frontmatter + body)
  body: string;         // Body only (after frontmatter)
}

export class SkillService {
  private readonly skillsDir: string;

  constructor(agentDir: string) {
    this.skillsDir = join(agentDir, ".claude", "skills");
  }

  /** List all skills with metadata */
  list(): SkillMeta[] {
    if (!existsSync(this.skillsDir)) return [];

    let entries: string[];
    try {
      entries = readdirSync(this.skillsDir);
    } catch {
      return [];
    }

    const skills: SkillMeta[] = [];
    for (const entry of entries.sort()) {
      const meta = this.readMeta(entry);
      if (meta) skills.push(meta);
    }
    return skills;
  }

  /** Get full skill content */
  get(name: string): SkillFull | null {
    const path = this.skillPath(name);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, "utf-8");
    const fm = this.parseFrontmatter(content);
    if (!fm) return null;

    return {
      name: (fm.data.name as string) || name,
      description: (fm.data.description as string) || "",
      origin: (fm.data.origin as string) || "user",
      disabled: fm.data["disable-model-invocation"] === true,
      content,
      body: fm.body,
    };
  }

  /** Toggle disable-model-invocation for a user skill */
  toggle(name: string): { disabled: boolean } {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    if (PROTECTED_ORIGINS.includes(skill.origin as any)) {
      throw new Error(`Cannot toggle "${name}" — it is a ${skill.origin} skill`);
    }

    const path = this.skillPath(name);
    const content = readFileSync(path, "utf-8");
    const fm = this.parseFrontmatter(content)!;

    const newDisabled = !skill.disabled;
    if (newDisabled) {
      fm.data["disable-model-invocation"] = true;
    } else {
      delete fm.data["disable-model-invocation"];
    }

    const newContent = `---\n${stringifyYaml(fm.data).trim()}\n---\n\n${fm.body}`;
    writeFileSync(path, newContent, "utf-8");

    return { disabled: newDisabled };
  }

  /** Delete a user skill directory */
  delete(name: string): void {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    if (PROTECTED_ORIGINS.includes(skill.origin as any)) {
      throw new Error(`Cannot delete "${name}" — it is a ${skill.origin} skill`);
    }
    rmSync(join(this.skillsDir, name), { recursive: true, force: true });
  }

  /** Update a user skill's description and content */
  update(name: string, description: string, content: string): SkillFull {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    if (PROTECTED_ORIGINS.includes(skill.origin as any)) {
      throw new Error(`Cannot update "${name}" — it is a ${skill.origin} skill`);
    }

    const contentResult = validateSkillContent(content);
    if (!contentResult.valid) throw new Error(contentResult.reason!);

    // Preserve existing frontmatter fields (like disable-model-invocation), update description
    const path = this.skillPath(name);
    const raw = readFileSync(path, "utf-8");
    const fm = this.parseFrontmatter(raw)!;
    fm.data.description = description;

    const newContent = `---\n${stringifyYaml(fm.data).trim()}\n---\n\n${content}`;
    writeFileSync(path, newContent, "utf-8");

    return this.get(name)!;
  }

  /** Check if a skill is user-editable */
  isEditable(name: string): boolean {
    const meta = this.readMeta(name);
    if (!meta) return false;
    return !PROTECTED_ORIGINS.includes(meta.origin as any);
  }

  // --- Internal helpers ---

  private skillPath(name: string): string {
    return join(this.skillsDir, name, "SKILL.md");
  }

  private readMeta(name: string): SkillMeta | null {
    const path = this.skillPath(name);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, "utf-8");
      const fm = this.parseFrontmatter(content);
      if (!fm) return null;

      return {
        name: (fm.data.name as string) || name,
        description: (fm.data.description as string) || "(no description)",
        origin: (fm.data.origin as string) || "user",
        disabled: fm.data["disable-model-invocation"] === true,
      };
    } catch {
      return null;
    }
  }

  private parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n*([\s\S]*)$/);
    if (!match) return null;
    try {
      const data = parseYaml(match[1]) as Record<string, unknown>;
      return { data, body: match[2] };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/services/skill-service.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/services/skill-service.ts packages/dashboard/tests/services/skill-service.test.ts
git commit -m "feat(m6.8-s6): SkillService — shared skill operations for REST + MCP"
```

---

### Task 2: REST Routes for Skills

**Files:**
- Create: `packages/dashboard/src/routes/skills.ts`
- Create: `packages/dashboard/tests/routes/skills-routes.test.ts`
- Modify: `packages/dashboard/src/server.ts` — register routes + add SkillService decorator

- [ ] **Step 1: Write route tests**

```typescript
// packages/dashboard/tests/routes/skills-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { SkillService } from "../../src/services/skill-service.js";

const TEST_DIR = join(import.meta.dirname, "tmp-skills-routes-test");
const SKILLS_DIR = join(TEST_DIR, ".claude", "skills");

function createTestSkill(name: string, origin = "user", disabled = false) {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const dm = disabled ? "\ndisable-model-invocation: true" : "";
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test ${name}\norigin: ${origin}${dm}\n---\n\nBody of ${name}`
  );
}

async function buildApp() {
  const fastify = Fastify();
  const service = new SkillService(TEST_DIR);
  fastify.decorate("agentDir", TEST_DIR);
  fastify.decorate("skillService", service);

  const { registerSkillRoutes } = await import("../../src/routes/skills.js");
  await fastify.register(
    async (instance) => { await registerSkillRoutes(instance); },
    { prefix: "/api/skills" }
  );
  return fastify;
}

describe("Skills REST routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    mkdirSync(SKILLS_DIR, { recursive: true });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("GET /api/skills", () => {
    it("returns empty array when no skills", async () => {
      const res = await app.inject({ method: "GET", url: "/api/skills" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ skills: [] });
    });

    it("returns all skills with metadata", async () => {
      createTestSkill("alpha", "user");
      createTestSkill("beta", "system");
      const res = await app.inject({ method: "GET", url: "/api/skills" });
      const body = res.json();
      expect(body.skills).toHaveLength(2);
      expect(body.skills[0].name).toBe("alpha");
      expect(body.skills[1].name).toBe("beta");
    });
  });

  describe("GET /api/skills/:name", () => {
    it("returns full skill content", async () => {
      createTestSkill("my-skill");
      const res = await app.inject({ method: "GET", url: "/api/skills/my-skill" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe("my-skill");
      expect(body.body).toContain("Body of my-skill");
    });

    it("returns 404 for missing skill", async () => {
      const res = await app.inject({ method: "GET", url: "/api/skills/nope" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/skills/:name/toggle", () => {
    it("toggles a user skill", async () => {
      createTestSkill("my-skill", "user", false);
      const res = await app.inject({ method: "POST", url: "/api/skills/my-skill/toggle" });
      expect(res.statusCode).toBe(200);
      expect(res.json().disabled).toBe(true);
    });

    it("rejects toggling system skill", async () => {
      createTestSkill("sys", "system");
      const res = await app.inject({ method: "POST", url: "/api/skills/sys/toggle" });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PUT /api/skills/:name", () => {
    it("updates a user skill", async () => {
      createTestSkill("my-skill", "user");
      const res = await app.inject({
        method: "PUT",
        url: "/api/skills/my-skill",
        payload: { description: "Updated desc", content: "Updated body" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe("Updated desc");
    });

    it("rejects updating system skill", async () => {
      createTestSkill("sys", "system");
      const res = await app.inject({
        method: "PUT",
        url: "/api/skills/sys",
        payload: { description: "x", content: "y" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects missing fields", async () => {
      createTestSkill("my-skill", "user");
      const res = await app.inject({
        method: "PUT",
        url: "/api/skills/my-skill",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/skills/:name", () => {
    it("deletes a user skill", async () => {
      createTestSkill("my-skill", "user");
      const res = await app.inject({ method: "DELETE", url: "/api/skills/my-skill" });
      expect(res.statusCode).toBe(200);
      // Verify it's gone
      const getRes = await app.inject({ method: "GET", url: "/api/skills/my-skill" });
      expect(getRes.statusCode).toBe(404);
    });

    it("rejects deleting system skill", async () => {
      createTestSkill("sys", "system");
      const res = await app.inject({ method: "DELETE", url: "/api/skills/sys" });
      expect(res.statusCode).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/routes/skills-routes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement routes**

```typescript
// packages/dashboard/src/routes/skills.ts
import type { FastifyInstance } from "fastify";

export async function registerSkillRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.skillService;

  /** GET /api/skills — list all skills */
  fastify.get("/", async () => {
    return { skills: service.list() };
  });

  /** GET /api/skills/:name — get full skill */
  fastify.get<{ Params: { name: string } }>("/:name", async (request, reply) => {
    const skill = service.get(request.params.name);
    if (!skill) return reply.code(404).send({ error: "Skill not found" });
    return skill;
  });

  /** POST /api/skills/:name/toggle — toggle disable-model-invocation */
  fastify.post<{ Params: { name: string } }>("/:name/toggle", async (request, reply) => {
    try {
      const result = service.toggle(request.params.name);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Toggle failed";
      if (msg.includes("not found")) return reply.code(404).send({ error: msg });
      return reply.code(403).send({ error: msg });
    }
  });

  /** PUT /api/skills/:name — update a user skill's description and content */
  fastify.put<{ Params: { name: string }; Body: { description: string; content: string } }>(
    "/:name",
    async (request, reply) => {
      const { description, content } = request.body || {};
      if (!description || !content) {
        return reply.code(400).send({ error: "description and content are required" });
      }
      try {
        const result = service.update(request.params.name, description, content);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Update failed";
        if (msg.includes("not found")) return reply.code(404).send({ error: msg });
        if (msg.includes("identity")) return reply.code(400).send({ error: msg });
        return reply.code(403).send({ error: msg });
      }
    },
  );

  /** DELETE /api/skills/:name — delete a user skill */
  fastify.delete<{ Params: { name: string } }>("/:name", async (request, reply) => {
    try {
      service.delete(request.params.name);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      if (msg.includes("not found")) return reply.code(404).send({ error: msg });
      return reply.code(403).send({ error: msg });
    }
  });
}
```

- [ ] **Step 4: Register routes in server.ts**

Add to `packages/dashboard/src/server.ts`:

```typescript
// Import
import { registerSkillRoutes } from "./routes/skills.js";
import { SkillService } from "./services/skill-service.js";

// In FastifyInstance type augmentation, add:
skillService: SkillService;

// After agentDir decorator, add:
fastify.decorate("skillService", new SkillService(options.agentDir));

// Register routes (alongside notebook):
await fastify.register(
  async (instance) => { await registerSkillRoutes(instance); },
  { prefix: "/api/skills" }
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/routes/skills-routes.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 682+ tests pass, 0 failures

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/routes/skills.ts packages/dashboard/tests/routes/skills-routes.test.ts packages/dashboard/src/services/skill-service.ts packages/dashboard/src/server.ts
git commit -m "feat(m6.8-s6): REST /api/skills routes + SkillService.delete()"
```

---

### Task 3: Refactor MCP Handlers to Use SkillService

**Files:**
- Modify: `packages/dashboard/src/mcp/skill-server.ts`
- Existing tests: `packages/dashboard/tests/mcp/skill-server.test.ts`

The MCP handlers currently do their own file I/O. Refactor `handleListSkills` and `handleGetSkill` to use SkillService. Leave `handleCreateSkill` and `handleUpdateSkill` as-is for now — they have creation/validation logic that's MCP-specific (name validation, content validation, description guidance). The goal is to consolidate read operations, not force everything through SkillService immediately.

- [ ] **Step 1: Update skill-server.ts to accept SkillService**

Add optional `skillService` to `SkillServerDeps`:

```typescript
// In SkillServerDeps interface
skillService?: SkillService;
```

Refactor `handleListSkills` to use service when available:

```typescript
export async function handleListSkills(agentDir: string, skillService?: SkillService): Promise<ToolResult> {
  if (skillService) {
    const skills = skillService.list();
    if (skills.length === 0) {
      return { content: [{ type: "text" as const, text: "No skills found." }] };
    }
    const lines = skills.map(s => `- **${s.name}** [${s.origin}]: ${s.description}${s.disabled ? " (disabled)" : ""}`);
    return { content: [{ type: "text" as const, text: `${skills.length} skill(s):\n${lines.join("\n")}` }] };
  }
  // ... existing implementation as fallback
}
```

- [ ] **Step 2: Run existing MCP tests**

Run: `cd packages/dashboard && npx vitest run tests/mcp/skill-server.test.ts`
Expected: All 17 tests still PASS (backward compatible)

- [ ] **Step 3: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 682+ pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/mcp/skill-server.ts
git commit -m "refactor(m6.8-s6): MCP list/get handlers can use SkillService"
```

---

### Task 4: Skills Tab in Notebook Widget (Desktop + Mobile)

**Files:**
- Modify: `packages/dashboard/public/js/app.js` — add skills state + `loadSkills()` method
- Modify: `packages/dashboard/public/index.html` — add 5th tab + skills content

This follows the exact pattern of the existing 4 notebook tabs. Skills tab shows a flat list of all skills with origin badges and disabled indicators.

- [ ] **Step 1: Add skills state to app.js**

In the Alpine data section (around line 239), add:

```javascript
// Skills (M6.8-S6)
skillsList: [],        // Array of { name, description, origin, disabled }
skillsLoading: false,
selectedSkill: null,   // Full skill object when viewing detail
skillEditMode: false,  // true when editing a skill
skillEditDesc: "",     // description field while editing
skillEditBody: "",     // body field while editing
```

Add `notebookTab` to include `'skills'`:

```javascript
notebookTab: sessionStorage.getItem("notebookTab") || "orders", // orders | lists | daily | knowledge | skills
```

Add `skills` to `notebookSections`:

```javascript
notebookSections: {
  orders: true,
  lists: true,
  daily: false,
  knowledge: false,
  skills: true,  // expanded by default
},
```

- [ ] **Step 2: Add loadSkills() method to app.js**

After `loadNotebookTree()` (around line 4974), add:

```javascript
async loadSkills() {
  this.skillsLoading = true;
  try {
    const res = await fetch("/api/skills");
    if (res.ok) {
      const data = await res.json();
      this.skillsList = data.skills || [];
    }
  } catch (err) {
    console.error("[App] Failed to load skills:", err);
    this.skillsList = [];
  } finally {
    this.skillsLoading = false;
  }
},

async toggleSkill(name) {
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}/toggle`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      // Update local state
      const skill = this.skillsList.find(s => s.name === name);
      if (skill) skill.disabled = data.disabled;
      if (this.selectedSkill?.name === name) this.selectedSkill.disabled = data.disabled;
    }
  } catch (err) {
    console.error("[App] Failed to toggle skill:", err);
  }
},

async deleteSkill(name) {
  if (!confirm(`Delete skill "${name}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.ok) {
      this.skillsList = this.skillsList.filter(s => s.name !== name);
      if (this.selectedSkill?.name === name) this.selectedSkill = null;
    }
  } catch (err) {
    console.error("[App] Failed to delete skill:", err);
  }
},

async viewSkill(name) {
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
    if (res.ok) {
      this.selectedSkill = await res.json();
      this.skillEditMode = false;
    }
  } catch (err) {
    console.error("[App] Failed to load skill:", err);
  }
},

async saveSkill(name, description, content) {
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, content }),
    });
    if (res.ok) {
      const updated = await res.json();
      this.selectedSkill = updated;
      this.skillEditMode = false;
      // Update list entry
      const idx = this.skillsList.findIndex(s => s.name === name);
      if (idx >= 0) {
        this.skillsList[idx].description = updated.description;
        this.skillsList[idx].disabled = updated.disabled;
      }
    }
  } catch (err) {
    console.error("[App] Failed to save skill:", err);
  }
},
```

- [ ] **Step 3: Call loadSkills() on init**

In the `init()` method (where `loadNotebookTree()` is called), add:

```javascript
this.loadSkills();
```

- [ ] **Step 4: Add Skills tab button in index.html**

In the notebook widget tab bar (after the Knowledge button, before `</div>` closing the tab bar), add:

```html
<button
  @click="setNotebookTab('skills')"
  :class="notebookTab === 'skills' ? 'text-tokyo-blue border-b-2 border-tokyo-blue' : 'text-tokyo-muted hover:text-tokyo-text'"
  class="flex-1 px-2 py-2 text-[11px] font-medium truncate transition-colors"
>
  Skills
</button>
```

- [ ] **Step 5: Add Skills tab content in index.html**

After the Knowledge tab content template (after line ~598), add:

```html
<!-- Skills tab (M6.8-S6) -->
<template x-if="!notebookLoading && notebookTab === 'skills'">
  <div class="space-y-1">
    <template x-if="skillsLoading">
      <div class="flex items-center justify-center h-20 text-tokyo-muted text-xs">
        Loading skills...
      </div>
    </template>
    <template x-if="!skillsLoading && skillsList.length === 0">
      <p class="text-xs text-tokyo-muted/60 italic py-4 text-center">
        No skills yet
      </p>
    </template>
    <template x-for="skill in skillsList" :key="skill.name">
      <button
        @click="$store.mobile.isMobile ? $store.mobile.openPopoverWithFocus('skill-detail', { name: skill.name }) : viewSkill(skill.name)"
        class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-tokyo-purple/10 transition-colors group text-left"
        :class="skill.disabled ? 'opacity-50' : ''"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
          class="w-3.5 h-3.5 text-tokyo-muted group-hover:text-tokyo-purple shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
        </svg>
        <span class="text-xs text-tokyo-text truncate flex-1" x-text="skill.name"></span>
        <span x-show="skill.origin !== 'user'"
          class="text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-400"
          x-text="skill.origin">
        </span>
        <span x-show="skill.disabled"
          class="text-[9px] px-1 py-px rounded bg-orange-500/15 text-orange-400">
          off
        </span>
      </button>
    </template>
  </div>
</template>
```

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `cd packages/dashboard && npx vitest run`
Expected: 682+ pass, 0 fail

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/public/js/app.js packages/dashboard/public/index.html
git commit -m "feat(m6.8-s6): Skills tab in notebook widget"
```

---

### Task 5: Skill Detail View + Actions (Desktop)

**Files:**
- Modify: `packages/dashboard/public/js/app.js` — skill detail panel logic
- Modify: `packages/dashboard/public/index.html` — skill detail panel in notebook browser

When a user clicks a skill in the notebook widget, it opens in the notebook browser panel (same pattern as clicking a notebook file). The detail view shows: rendered markdown content, origin badge, toggle/edit/delete buttons (user skills only). Edit mode uses a textarea for the body + description field, saving via PUT /api/skills/:name.

- [ ] **Step 1: Add Skills section to notebook browser**

In the notebook browser tab (after the Knowledge collapsible section, around line 2875), add a Skills section:

```html
<!-- Skills section (M6.8-S6) -->
<div class="mt-4">
  <button
    @click="notebookSections.skills = !notebookSections.skills"
    class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] rounded-lg transition-colors"
  >
    <div class="flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
        class="w-4 h-4 text-tokyo-purple transition-transform"
        :class="notebookSections.skills ? 'rotate-90' : ''">
        <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
      </svg>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
        class="w-4 h-4 text-tokyo-purple">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
      </svg>
      <span class="text-sm font-medium">Skills</span>
    </div>
    <span class="text-xs text-tokyo-muted" x-text="skillsList.length + ' skills'"></span>
  </button>
  <div x-show="notebookSections.skills" x-collapse class="pl-6 pr-2 space-y-0.5 mt-1">
    <template x-for="skill in skillsList" :key="skill.name">
      <button
        @click="viewSkill(skill.name)"
        class="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors text-left"
        :class="skill.disabled ? 'opacity-50' : ''"
      >
        <span class="text-sm text-tokyo-text truncate flex-1" x-text="skill.name"></span>
        <span x-show="skill.origin !== 'user'"
          class="text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-400"
          x-text="skill.origin">
        </span>
      </button>
    </template>
    <template x-if="skillsList.length === 0">
      <p class="text-xs text-tokyo-muted/40 italic py-2 pl-3">No skills</p>
    </template>
  </div>
</div>
```

- [ ] **Step 2: Add skill detail panel**

When `selectedSkill` is set, show it in the notebook browser's detail area (the right side, same area as `selectedNotebookFile`). Modify the detail panel area to also handle skills.

In `app.js`, add a computed or method to track when showing a skill vs notebook file. The simplest approach: when `viewSkill()` is called, open the notebook browser and set `selectedSkill`, clearing `selectedNotebookFile`.

```javascript
// In viewSkill():
async viewSkill(name) {
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
    if (res.ok) {
      this.selectedSkill = await res.json();
      this.selectedNotebookFile = null; // Clear notebook file selection
      // Open notebook browser if not already open
      if (this.activeTab !== 'notebook-browser') {
        this.openNotebookBrowser();
      }
    }
  } catch (err) {
    console.error("[App] Failed to load skill:", err);
  }
},
```

In `index.html`, add a skill detail template alongside the existing notebook file detail:

```html
<!-- Skill detail view (M6.8-S6) -->
<template x-if="selectedSkill && !selectedNotebookFile">
  <div class="flex-1 flex flex-col min-h-0">
    <!-- Header -->
    <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold" x-text="selectedSkill.name"></h2>
        <p class="text-xs text-tokyo-muted mt-0.5" x-text="selectedSkill.description"></p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] px-1.5 py-0.5 rounded"
          :class="selectedSkill.origin === 'user' ? 'bg-green-500/15 text-green-400' : 'bg-violet-500/15 text-violet-400'"
          x-text="selectedSkill.origin">
        </span>
        <!-- Toggle button (user skills only) -->
        <template x-if="selectedSkill.origin === 'user'">
          <button
            @click="toggleSkill(selectedSkill.name)"
            class="text-xs px-2 py-1 rounded transition-colors"
            :class="selectedSkill.disabled ? 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/25' : 'bg-green-500/15 text-green-400 hover:bg-green-500/25'"
            x-text="selectedSkill.disabled ? 'Enable' : 'Disable'">
          </button>
        </template>
        <!-- Edit button (user skills only) -->
        <template x-if="selectedSkill.origin === 'user'">
          <button
            @click="skillEditMode = true; skillEditDesc = selectedSkill.description; skillEditBody = selectedSkill.body"
            class="text-xs px-2 py-1 rounded bg-tokyo-blue/15 text-tokyo-blue hover:bg-tokyo-blue/25 transition-colors">
            Edit
          </button>
        </template>
        <!-- Delete button (user skills only) -->
        <template x-if="selectedSkill.origin === 'user'">
          <button
            @click="deleteSkill(selectedSkill.name)"
            class="text-xs px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
            Delete
          </button>
        </template>
        <!-- Close -->
        <button @click="selectedSkill = null; skillEditMode = false" class="text-tokyo-muted hover:text-tokyo-text ml-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
    <!-- Content: view mode -->
    <template x-if="!skillEditMode">
      <div class="flex-1 overflow-y-auto p-6 prose prose-invert prose-sm max-w-none"
        x-html="renderMarkdown(selectedSkill.body || '')">
      </div>
    </template>
    <!-- Content: edit mode (user skills only) -->
    <template x-if="skillEditMode">
      <div class="flex-1 overflow-y-auto p-6 space-y-3">
        <div>
          <label class="text-xs text-tokyo-muted mb-1 block">Description</label>
          <input type="text" x-model="skillEditDesc"
            class="w-full bg-[#1e1e2e] border border-white/15 rounded px-3 py-1.5 text-sm text-tokyo-text focus:border-white/35 outline-none" />
        </div>
        <div class="flex-1">
          <label class="text-xs text-tokyo-muted mb-1 block">Content (markdown)</label>
          <textarea x-model="skillEditBody"
            class="w-full h-[300px] bg-[#1e1e2e] border border-white/15 rounded px-3 py-2 text-sm text-tokyo-text font-mono focus:border-white/35 outline-none resize-y"></textarea>
        </div>
        <div class="flex gap-2">
          <button
            @click="saveSkill(selectedSkill.name, skillEditDesc, skillEditBody)"
            class="text-xs px-3 py-1.5 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors">
            Save
          </button>
          <button
            @click="skillEditMode = false"
            class="text-xs px-3 py-1.5 rounded bg-white/5 text-tokyo-muted hover:bg-white/10 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 3: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 682+ pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/public/js/app.js packages/dashboard/public/index.html
git commit -m "feat(m6.8-s6): skill detail view with toggle + delete in notebook browser"
```

---

### Task 6: Mobile Skill Detail Popover

**Files:**
- Modify: `packages/dashboard/public/index.html` — add `skill-detail` popover type

The mobile notebook uses popovers. Add a `skill-detail` popover that shows skill content with toggle/delete actions.

- [ ] **Step 1: Add skill-detail popover**

In the mobile popovers section (after the `notebook-file` popover, around line 7244), add:

```html
<!-- Skill detail popover (M6.8-S6) -->
<template x-if="$store.mobile.popover?.type === 'skill-detail'">
  <div class="p-4" x-data="{ skillData: null, loading: true }"
    x-init="fetch('/api/skills/' + encodeURIComponent($store.mobile.popover.data?.name))
      .then(r => r.json()).then(d => { skillData = d; loading = false })
      .catch(() => { loading = false })">

    <template x-if="loading">
      <div class="text-center text-tokyo-muted text-sm py-8">Loading...</div>
    </template>

    <template x-if="!loading && skillData">
      <div>
        <!-- Header -->
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-base font-semibold" x-text="skillData.name"></h3>
          <span class="text-[10px] px-1.5 py-0.5 rounded"
            :class="skillData.origin === 'user' ? 'bg-green-500/15 text-green-400' : 'bg-violet-500/15 text-violet-400'"
            x-text="skillData.origin">
          </span>
        </div>
        <p class="text-xs text-tokyo-muted mb-4" x-text="skillData.description"></p>

        <!-- Actions (user skills only) -->
        <template x-if="skillData.origin === 'user'">
          <div class="flex gap-2 mb-4">
            <button
              @click="toggleSkill(skillData.name).then(() => { skillData.disabled = !skillData.disabled })"
              class="text-xs px-3 py-1.5 rounded transition-colors"
              :class="skillData.disabled ? 'bg-orange-500/15 text-orange-400' : 'bg-green-500/15 text-green-400'"
              x-text="skillData.disabled ? 'Enable' : 'Disable'">
            </button>
            <button
              @click="deleteSkill(skillData.name).then(() => $store.mobile.closePopover())"
              class="text-xs px-3 py-1.5 rounded bg-red-500/15 text-red-400">
              Delete
            </button>
          </div>
        </template>

        <!-- Content -->
        <div class="prose prose-invert prose-sm max-w-none"
          x-html="renderMarkdown(skillData.body || '')">
        </div>
      </div>
    </template>

    <template x-if="!loading && !skillData">
      <p class="text-sm text-tokyo-muted text-center py-8">Skill not found</p>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Add skills section to mobile notebook browser popover**

In the mobile notebook browser popover (around line 7222, after the Knowledge section), add:

```html
<!-- Skills section (M6.8-S6) -->
<div class="mt-3 border-t border-white/5 pt-3">
  <div class="flex items-center justify-between px-1 mb-2">
    <div class="flex items-center gap-1.5">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
        class="w-3.5 h-3.5 text-tokyo-purple">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
      </svg>
      <span class="text-xs font-medium text-tokyo-text">Skills</span>
    </div>
    <span class="text-[10px] text-tokyo-muted" x-text="skillsList.length"></span>
  </div>
  <div class="space-y-0.5">
    <template x-for="skill in skillsList" :key="skill.name">
      <button
        @click="$store.mobile.openPopoverWithFocus('skill-detail', { name: skill.name })"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-tokyo-purple/10 transition-colors text-left"
        :class="skill.disabled ? 'opacity-50' : ''"
      >
        <span class="text-xs text-tokyo-text truncate flex-1" x-text="skill.name"></span>
        <span x-show="skill.origin !== 'user'"
          class="text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-400"
          x-text="skill.origin">
        </span>
        <span x-show="skill.disabled"
          class="text-[9px] px-1 py-px rounded bg-orange-500/15 text-orange-400">off</span>
      </button>
    </template>
    <template x-if="skillsList.length === 0">
      <p class="text-[10px] text-tokyo-muted/40 italic py-1 pl-2">No skills</p>
    </template>
  </div>
</div>
```

- [ ] **Step 3: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 682+ pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(m6.8-s6): mobile skill detail popover + skills in mobile notebook browser"
```

---

### Task 7: Browser E2E Validation

**Files:**
- Create: `packages/dashboard/tests/e2e/skills-ui.test.ts`

Playwright tests that validate the complete M6.8 skills flow through the browser:
1. Skills tab shows skills
2. Click skill opens detail view
3. Toggle disables/enables a skill
4. System skills show as read-only (no toggle/delete buttons)

**Prerequisites:** Dashboard must be running (`systemctl --user restart nina-dashboard.service`).

- [ ] **Step 1: Write E2E test**

```typescript
// packages/dashboard/tests/e2e/skills-ui.test.ts
import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = "http://localhost:4321";

describe("Skills UI E2E", () => {
  beforeAll(async () => {
    // Verify dashboard is running
    const res = await fetch(BASE_URL);
    expect(res.ok).toBe(true);
  });

  it("GET /api/skills returns skill list", async () => {
    const res = await fetch(`${BASE_URL}/api/skills`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.skills).toBeInstanceOf(Array);
    expect(data.skills.length).toBeGreaterThan(0);
  });

  it("GET /api/skills/:name returns skill detail", async () => {
    // Get first skill name
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
  });

  it("system/curated skills cannot be toggled", async () => {
    const listRes = await fetch(`${BASE_URL}/api/skills`);
    const { skills } = await listRes.json();
    const systemSkill = skills.find((s: any) => s.origin === "system" || s.origin === "curated");
    if (!systemSkill) return; // skip if no system skills

    const res = await fetch(`${BASE_URL}/api/skills/${systemSkill.name}/toggle`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("system/curated skills cannot be deleted", async () => {
    const listRes = await fetch(`${BASE_URL}/api/skills`);
    const { skills } = await listRes.json();
    const systemSkill = skills.find((s: any) => s.origin === "system" || s.origin === "curated");
    if (!systemSkill) return;

    const res = await fetch(`${BASE_URL}/api/skills/${systemSkill.name}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Restart dashboard service**

Run: `systemctl --user restart nina-dashboard.service`
Wait 3 seconds, verify: `curl -s http://localhost:4321/ | head -5`

- [ ] **Step 3: Run E2E tests**

Run: `cd packages/dashboard && npx vitest run tests/e2e/skills-ui.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Run full test suite (unit + E2E)**

Run: `cd packages/dashboard && npx vitest run`
Expected: 690+ pass (682 baseline + ~8 new), 0 fail

Also run core tests:
Run: `cd packages/core && npx vitest run`
Expected: 171 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/e2e/skills-ui.test.ts
git commit -m "test(m6.8-s6): E2E validation of skills UI + API"
```

---

### Task 8: Sprint Artifacts + Roadmap Update

**Files:**
- Create: `docs/sprints/m6.8-s6-dashboard-ui-validation/DECISIONS.md`
- Create: `docs/sprints/m6.8-s6-dashboard-ui-validation/DEVIATIONS.md`
- Modify: `docs/ROADMAP.md` — mark S6 as complete, update M6.8 progress

- [ ] **Step 1: Create DECISIONS.md with all decisions logged during execution**

- [ ] **Step 2: Create DEVIATIONS.md (empty if no deviations)**

- [ ] **Step 3: Update ROADMAP.md**

Mark M6.8-S6 as complete. If this is the final sprint of M6.8, mark the milestone as complete.

- [ ] **Step 4: Commit**

```bash
git add docs/sprints/m6.8-s6-dashboard-ui-validation/ docs/ROADMAP.md
git commit -m "docs(m6.8-s6): sprint artifacts + roadmap update"
```
