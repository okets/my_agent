import { parse as parseYaml } from "yaml";

export const PROTECTED_ORIGINS = ["system", "curated"] as const;

// Identity-override patterns — phrases that attempt to change the agent's core identity
const IDENTITY_OVERRIDE_PATTERNS = [
  /your name is\s+\w/i,
  /you are (now|a|an)\s+/i,
  /change your (personality|name|identity|communication style)/i,
  /from now on.*(speak|talk|respond|act|behave)\s+(in|as|like)/i,
  /always speak in\s+\w/i,
  /you must (always|never) (speak|talk|respond)/i,
];

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

interface FrontmatterResult {
  valid: boolean;
  reason?: string;
  frontmatter?: {
    name: string;
    description: string;
    origin: string;
    [key: string]: unknown;
  };
  body?: string;
}

export function validateSkillName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) {
    return { valid: false, reason: "Skill name cannot be empty" };
  }
  if (name.length > 64) {
    return {
      valid: false,
      reason: "Skill name must be 64 characters or fewer",
    };
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return {
      valid: false,
      reason:
        "Skill name must be kebab-case (lowercase letters, numbers, hyphens)",
    };
  }
  return { valid: true };
}

export function validateSkillContent(content: string): ValidationResult {
  for (const pattern of IDENTITY_OVERRIDE_PATTERNS) {
    if (pattern.test(content)) {
      return {
        valid: false,
        reason:
          "Skill content appears to override agent identity. Skills provide capabilities — they never change name, personality, or communication style.",
      };
    }
  }
  return { valid: true };
}

export function parseSkillFrontmatter(content: string): FrontmatterResult {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n*([\s\S]*)$/);
  if (!fmMatch) {
    return {
      valid: false,
      reason: "SKILL.md must start with YAML frontmatter (---\\n...\\n---)",
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(fmMatch[1]) as Record<string, unknown>;
  } catch (e) {
    return {
      valid: false,
      reason: `Invalid YAML frontmatter: ${(e as Error).message}`,
    };
  }

  if (!parsed.name || typeof parsed.name !== "string") {
    return { valid: false, reason: 'Frontmatter must include a "name" field' };
  }
  if (!parsed.description || typeof parsed.description !== "string") {
    return {
      valid: false,
      reason: 'Frontmatter must include a "description" field',
    };
  }

  const origin = (parsed.origin as string) || "user";
  if (
    PROTECTED_ORIGINS.includes(origin as (typeof PROTECTED_ORIGINS)[number])
  ) {
    return {
      valid: false,
      reason: `Cannot use protected origin "${origin}". User-created skills must use origin: user`,
    };
  }

  return {
    valid: true,
    frontmatter: {
      ...parsed,
      name: parsed.name as string,
      description: parsed.description as string,
      origin: "user", // Always force user origin
    },
    body: fmMatch[2],
  };
}
