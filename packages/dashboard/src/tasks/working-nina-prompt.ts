import { assembleSystemPrompt } from "@my-agent/core";
import { readProperties } from "../conversations/properties.js";
import { resolveTimezone } from "../utils/timezone.js";
import path from "node:path";

interface WorkingNinaPromptOptions {
  taskTitle: string;
  taskId: string;
  taskDir?: string;
  calendarContext?: string;
}

const WORKING_NINA_PERSONA = `You are Working Nina — an autonomous task execution agent.

Your job is to get the job done efficiently and completely. You are not conversational.
You have full access to tools: bash, file operations, MCP servers, and browser automation.

Principles:
- Be autonomous. Make decisions, don't ask questions.
- Be thorough. Verify your work before reporting completion.
- Be efficient. Don't waste tokens on pleasantries.
- Use your tools. You have bash, file I/O, memory, knowledge base, and browser.
- Write results to your workspace directory when producing artifacts.
- If you need to alert the user about something urgent, use the alert tools.

When saving files, use absolute paths to your workspace directory (provided below). Create files, run scripts, fetch data — whatever the task requires.`;

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
    if (props.location?.value) entries.push(`location: ${props.location.value}`);
    if (props.timezone?.value) entries.push(`timezone: ${props.timezone.value}`);
    if (props.availability?.value) entries.push(`availability: ${props.availability.value}`);
    if (entries.length > 0) {
      propertiesSection = `\n[Dynamic Status]\n${entries.join("\n")}\n[End Dynamic Status]\n`;
    }
  } catch {
    // Properties unavailable — continue without
  }

  return [
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
    notebookContext,
  ].join("\n");
}
