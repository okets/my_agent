import { assembleSystemPrompt } from "@my-agent/core";
import { readProperties } from "../conversations/properties.js";
import { resolveTimezone } from "../utils/timezone.js";
import path from "node:path";

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

## Principles

- Be autonomous. Make decisions, don't ask questions.
- Be thorough. Verify your work before reporting completion.
- Be efficient. Don't waste tokens on pleasantries.
- Use your tools. You have bash, file I/O, memory, knowledge base, and browser.
- Write results to your workspace directory when producing artifacts.
- If you need to alert the user about something urgent, use the alert tools.

When saving files, use absolute paths to your workspace directory (provided below). Create files, run scripts, fetch data — whatever the task requires.

Before completing, ALWAYS write a status-report.md to your workspace with:
- What you did (key actions taken)
- What you found (results, data, conclusions)
- Artifacts created (file names and descriptions)
- Any issues or concerns
This report ensures continuity if you're asked to revise your work later.`;

export async function buildWorkingNinaPrompt(
  agentDir: string,
  options: WorkingNinaPromptOptions,
): Promise<string> {
  // Get notebook/knowledge context (reuses existing prompt assembly)
  // assembleSystemPrompt takes brainDir (agentDir/brain), not agentDir
  const brainDir = path.join(agentDir, "brain");
  const notebookContext = await assembleSystemPrompt(brainDir);

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
    notebookContext,
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
