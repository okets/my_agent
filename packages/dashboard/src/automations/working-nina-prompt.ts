import { readProperties } from "../conversations/properties.js";
import { resolveTimezone } from "../utils/timezone.js";

export interface WorkingNinaPromptOptions {
  taskTitle: string;
  taskId: string;
  taskDir?: string;
  calendarContext?: string;
  toolCreationGuide?: boolean;
  spaceContexts?: string[];
}

const TOOL_CREATION_GUIDE = `
## Tool Space Creation Guide

When creating a new tool space, follow this structure:

### Directory Layout
\`\`\`
.my_agent/spaces/{tool-name}/
  SPACE.md          # Manifest (YAML frontmatter + description)
  DECISIONS.md      # Operational history (created automatically)
  src/              # Source code
\`\`\`

### SPACE.md Format
\`\`\`yaml
---
name: tool-name
tags: [tool, category]
runtime: uv            # uv | node | bash
entry: src/main.py     # entry point relative to space dir
io:
  input:
    param_name: type   # string | number | file | boolean
  output:
    result_name: type  # stdout (JSON) | file (path)
maintenance:
  on_failure: fix      # fix | replace | alert
  log: DECISIONS.md
created: YYYY-MM-DD
---

# Tool Name

Description of what the tool does.

## Maintenance Rules

- Specific repair guidance for this tool
- What to check when things break
\`\`\`

### Runtime Setup
- **uv:** \`cd space && uv init && uv add dependencies\`
- **node:** \`cd space && npm init -y && npm install dependencies\`
- **bash:** No setup needed, ensure script is executable

### After Creation
1. Write SPACE.md with proper frontmatter
2. Initialize DECISIONS.md: log "created" entry with rationale
3. Bootstrap runtime (uv init, npm init, etc.)
4. Write source code
5. Test with sample input: cd space && runtime run entry '{sample_input}'
6. Verify output matches io.output contract
`;

const WORKING_NINA_PERSONA = `You are Working Nina — an autonomous task execution agent.

Your job is to get the job done efficiently and completely. You are not conversational.
You have full access to tools: bash, file operations, MCP servers, and browser automation.

## Todo System (MANDATORY)

You have a todo list managed via MCP tools. This is your work plan — follow it.

1. **Start by calling \`todo_list\`** to see your assigned tasks.
2. **Before starting each item**, call \`todo_update(id, "in_progress")\`.
3. **After completing each item**, call \`todo_update(id, "done")\`.
4. Items marked \`mandatory: true\` MUST be completed. You cannot delete them.
5. Some items have validators — if \`todo_update(id, "done")\` fails, read the error, fix the issue, then call \`todo_update(id, "done")\` AGAIN. Do not move on until validated items pass.
6. You may add your own items with \`todo_add(text)\` for sub-tasks you discover.

If you skip the todo system, your job will be flagged as needs_review regardless of how well you did the actual work.

## Pre-Completion Self-Check

Before ending your session, verify ALL of the following:

1. **Todo check:** Call \`todo_list\` — are all mandatory items marked "done"? If not, go back and complete them.
2. **Output check:** Re-read any files you created. Does the content match what was requested? Is it complete, not truncated?
3. **Status report:** Write \`status-report.md\` to your workspace with these sections:
   - **Actions taken** — what you did (key steps, tools used)
   - **Results** — what you found or produced (data, conclusions)
   - **Artifacts** — file names and one-line descriptions
   - **Issues** — anything unresolved, unexpected, or needing follow-up
4. **Format check:** If the task specified an output format, verify your deliverable matches it exactly.

Do not assume your work is correct — verify by re-reading output files.
Do not waste tokens on pleasantries or narration. Be autonomous — make decisions, don't ask questions.

## Visual Output

When your task involves visual output (screenshots, images), include the most relevant screenshot URL(s) as markdown images in your summary. The framework provides URLs in the format "Screenshot URL: /api/assets/screenshots/ss-xxx.png". Pick the result, not the journey. Use standard markdown: ![description](url)`;

export async function buildWorkingNinaPrompt(
  agentDir: string,
  options: WorkingNinaPromptOptions,
): Promise<string> {
  // M9.2-S8: Workers get their own persona + task context only.
  // Brain identity, delegation protocol, daily logs, notebook tree,
  // automation hints, and standing orders are brain-only concerns.

  // Get temporal context
  const timezone = await resolveTimezone(agentDir);
  const now = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  });

  // Get dynamic properties (structured PropertiesMap from dashboard's readProperties)
  let propertiesSection = "";
  try {
    const props = await readProperties(agentDir);
    const entries: string[] = [];
    if (props.location?.value)
      entries.push(`location: ${props.location.value}`);
    // timezone omitted — single source of truth is config.yaml, shown in [Temporal Context]
    if (props.availability?.value)
      entries.push(`availability: ${props.availability.value}`);
    if (entries.length > 0) {
      propertiesSection = `\n[Dynamic Status]\n${entries.join("\n")}\n[End Dynamic Status]\n`;
    }
  } catch {
    // Properties unavailable — continue without
  }

  const sections = [
    WORKING_NINA_PERSONA,
    "",
    `[Temporal Context]`,
    `Current time: ${now}`,
    `Timezone: ${timezone}`,
    `Task: ${options.taskTitle} (${options.taskId})`,
    options.taskDir ? `Workspace: ${options.taskDir}` : "",
    `[End Temporal Context]`,
    propertiesSection,
    options.calendarContext ? `\n${options.calendarContext}\n` : "",
    options.toolCreationGuide ? TOOL_CREATION_GUIDE : "",
  ];

  // Space contexts (tool manifests + maintenance rules for referenced spaces)
  if (options.spaceContexts && options.spaceContexts.length > 0) {
    sections.push("");
    sections.push("[Available Tool Spaces]");
    for (const ctx of options.spaceContexts) {
      sections.push(ctx);
      sections.push("---");
    }
    sections.push("[End Tool Spaces]");
  }

  return sections.join("\n");
}
