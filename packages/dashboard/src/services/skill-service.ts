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
  content: string; // Full raw file content (frontmatter + body)
  body: string; // Body only (after frontmatter)
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
      throw new Error(
        `Cannot toggle "${name}" — it is a ${skill.origin} skill`,
      );
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
      throw new Error(
        `Cannot delete "${name}" — it is a ${skill.origin} skill`,
      );
    }
    rmSync(join(this.skillsDir, name), { recursive: true, force: true });
  }

  /** Update a user skill's description and content */
  update(name: string, description: string, content: string): SkillFull {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    if (PROTECTED_ORIGINS.includes(skill.origin as any)) {
      throw new Error(
        `Cannot update "${name}" — it is a ${skill.origin} skill`,
      );
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

  private parseFrontmatter(
    content: string,
  ): { data: Record<string, unknown>; body: string } | null {
    const match = content.match(
      /^---\r?\n([\s\S]*?)\r?\n---\r?\n*([\s\S]*)$/,
    );
    if (!match) return null;
    try {
      const data = parseYaml(match[1]) as Record<string, unknown>;
      return { data, body: match[2] };
    } catch {
      return null;
    }
  }
}
