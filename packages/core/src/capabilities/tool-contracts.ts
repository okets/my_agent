/**
 * Tool contracts for MCP capability validation.
 *
 * Each well-known MCP type defines required and optional tools with
 * their expected input parameters. The test harness uses these to
 * validate that a capability implementation meets the contract.
 */

export interface ToolParam {
  name: string
  required: boolean
}

export interface ToolSpec {
  name: string
  requiredParams: ToolParam[]
}

export interface ToolContract {
  type: string
  required: ToolSpec[]
  optional: ToolSpec[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export const DESKTOP_CONTROL_CONTRACT: ToolContract = {
  type: 'desktop-control',
  required: [
    { name: 'desktop_screenshot', requiredParams: [] },
    { name: 'desktop_click', requiredParams: [{ name: 'x', required: true }, { name: 'y', required: true }] },
    { name: 'desktop_type', requiredParams: [{ name: 'text', required: true }] },
    { name: 'desktop_key', requiredParams: [{ name: 'key', required: true }] },
    { name: 'desktop_scroll', requiredParams: [{ name: 'x', required: true }, { name: 'y', required: true }, { name: 'direction', required: true }] },
    { name: 'desktop_info', requiredParams: [{ name: 'query', required: true }] },
    { name: 'desktop_wait', requiredParams: [{ name: 'seconds', required: true }] },
  ],
  optional: [
    { name: 'desktop_diff_check', requiredParams: [] },
    { name: 'desktop_find_element', requiredParams: [{ name: 'query', required: true }] },
    { name: 'desktop_ocr', requiredParams: [] },
    { name: 'desktop_window_screenshot', requiredParams: [{ name: 'windowId', required: true }] },
    { name: 'desktop_drag', requiredParams: [{ name: 'fromX', required: true }, { name: 'fromY', required: true }, { name: 'toX', required: true }, { name: 'toY', required: true }] },
  ],
}

const CONTRACTS: Record<string, ToolContract> = {
  'desktop-control': DESKTOP_CONTROL_CONTRACT,
}

export function getToolContract(type: string): ToolContract | undefined {
  return CONTRACTS[type]
}

/**
 * Validate a set of MCP tools against a well-known type contract.
 *
 * - All required tools must be present with correct required params
 * - Optional tools, if present, must have correct required params
 * - Custom tools (not in contract) are ignored
 */
export function validateToolContract(
  type: string,
  tools: Array<{ name: string; inputSchema: unknown }>,
): ValidationResult {
  const contract = CONTRACTS[type]
  if (!contract) {
    return { valid: true, errors: [] } // No contract = no validation
  }

  const errors: string[] = []
  const toolMap = new Map(tools.map(t => [t.name, t]))

  // Check required tools
  for (const spec of contract.required) {
    const tool = toolMap.get(spec.name)
    if (!tool) {
      errors.push(`Missing required tool: ${spec.name}`)
      continue
    }
    validateParams(spec, tool.inputSchema, errors)
  }

  // Check optional tools (only if present)
  for (const spec of contract.optional) {
    const tool = toolMap.get(spec.name)
    if (!tool) continue // Optional — absence is fine
    validateParams(spec, tool.inputSchema, errors)
  }

  return { valid: errors.length === 0, errors }
}

function validateParams(
  spec: ToolSpec,
  inputSchema: unknown,
  errors: string[],
): void {
  if (!inputSchema || typeof inputSchema !== 'object') return

  const schema = inputSchema as { properties?: Record<string, unknown>; required?: string[] }
  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  for (const param of spec.requiredParams) {
    if (!(param.name in properties)) {
      errors.push(`Tool "${spec.name}" missing required parameter: ${param.name}`)
    } else if (param.required && !required.includes(param.name)) {
      errors.push(`Tool "${spec.name}" parameter "${param.name}" should be required`)
    }
  }
}
