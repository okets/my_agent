/**
 * Space manifest maintenance configuration
 */
export interface SpaceMaintenance {
  on_failure: 'fix' | 'replace' | 'alert'
  log?: string
}

/**
 * Space I/O contract — defines input/output for tool spaces
 */
export interface SpaceIO {
  input?: Record<string, string>
  output?: Record<string, string>
}

/**
 * Space manifest frontmatter — the YAML fields in SPACE.md
 */
export interface SpaceManifest {
  name: string
  tags?: string[]
  path?: string          // external spaces only — points to real folder
  runtime?: string       // 'uv' | 'node' | 'bash' (if executable)
  entry?: string         // entry point file (if tool)
  io?: SpaceIO           // I/O contract (if tool)
  maintenance?: SpaceMaintenance
  created: string        // ISO date string
}

/**
 * Space entity — in-memory representation (combines manifest + derived data)
 */
export interface Space {
  /** Space name (directory name, also primary key in agent.db) */
  name: string
  /** Absolute path to the space directory in .my_agent/spaces/{name}/ */
  manifestDir: string
  /** Tags for discovery */
  tags: string[]
  /** For external spaces: absolute path to the real folder */
  path?: string
  /** Runtime (uv, node, bash) — present means it's a code project */
  runtime?: string
  /** Entry point — present (with runtime + io) means it's a tool */
  entry?: string
  /** I/O contract */
  io?: SpaceIO
  /** Maintenance config */
  maintenance?: SpaceMaintenance
  /** Markdown body from SPACE.md (description) */
  description: string
  /** When this space was created */
  created: string
  /** When agent.db last indexed this space */
  indexedAt: string
}

/**
 * Input for creating a new space
 */
export interface CreateSpaceInput {
  name: string
  tags?: string[]
  path?: string
  runtime?: string
  entry?: string
  io?: SpaceIO
  maintenance?: SpaceMaintenance
  description?: string
}

/**
 * Filters for listing spaces
 */
export interface ListSpacesFilter {
  /** Filter by tag (spaces containing this tag) */
  tag?: string
  /** Filter by runtime */
  runtime?: string
  /** Free-text search on name + description + tags */
  search?: string
}

/**
 * A space is a tool when it has runtime + entry + io.
 * Tool spaces can be invoked via shell commands and have I/O contracts.
 */
export function isToolSpace(space: Space): boolean {
  return !!(space.runtime && space.entry && space.io)
}
