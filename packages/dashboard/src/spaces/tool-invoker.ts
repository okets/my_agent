import type { Space, SpaceIO } from "@my-agent/core";

/** Runtime -> shell command prefix mapping */
const RUNTIME_COMMANDS: Record<string, string> = {
  uv: "uv run",
  node: "node",
  bash: "bash",
};

/** Build the shell invocation command for a tool space */
export function buildToolCommand(
  space: Space,
  input: Record<string, unknown>,
): string {
  if (!space.runtime || !space.entry) {
    throw new Error(
      `Space "${space.name}" is not a tool (missing runtime or entry)`,
    );
  }
  const cmd = RUNTIME_COMMANDS[space.runtime];
  if (!cmd) {
    throw new Error(`Unsupported runtime: ${space.runtime}`);
  }
  const inputJson = JSON.stringify(input);
  // Shell convention from spec: cd space && runtime run entry '{input}'
  return `cd ${space.path} && ${cmd} ${space.entry} '${inputJson}'`;
}

/** Error detection hierarchy result */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  errorType?: "exit_code" | "empty_stdout" | "invalid_json" | "semantic";
}

/** Classify tool output using the error detection hierarchy */
export function classifyToolOutput(
  exitCode: number,
  stdout: string,
  io?: SpaceIO,
): ToolResult {
  // 1. Exit code != 0 -> crash
  if (exitCode !== 0) {
    return {
      success: false,
      output: stdout,
      error: stdout,
      errorType: "exit_code",
    };
  }
  // 2. Empty stdout -> no results
  if (!stdout.trim()) {
    return {
      success: false,
      output: "",
      error: "Tool produced no output",
      errorType: "empty_stdout",
    };
  }
  // 3. If output type is stdout (JSON expected), validate JSON
  if (io?.output && Object.values(io.output).some((t) => t !== "file")) {
    try {
      JSON.parse(stdout);
    } catch {
      return {
        success: false,
        output: stdout,
        error: "Tool output is not valid JSON",
        errorType: "invalid_json",
      };
    }
  }
  // 4. Semantic issues -> detected by LLM at runtime (not here)
  return { success: true, output: stdout };
}
