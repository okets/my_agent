# CAPABILITY.md Templates

## Script Interface (voice, image)

```yaml
---
name: <Human-readable name>
provides: <well-known type or omit for custom>
interface: script
requires:
  env:
    - <API_KEY_NAME>
---

<Description of what this capability does.>

## <script-name>

- **Input:** `scripts/<script>.sh <arg1> [arg2]`
- **Output:** JSON `{ "key": "value" }`

<Additional usage notes, error cases, limitations.>
```

## MCP Interface (desktop control)

```yaml
---
name: <Human-readable name> (<Platform>)
provides: <well-known type>
interface: mcp
entrypoint: npx tsx src/server.ts
requires:
  env: []
  system:
    - <required-cli-tool>
---

<Description of what this capability does.>
```

**Key differences from script:**
- `interface: mcp` — brain calls tools directly via MCP protocol
- `entrypoint` — command to start the MCP server (framework spawns as child process)
- `requires.system` — CLI tools that must be present (checked by detect.sh)
- No scripts/ for the main capability — the MCP server IS the capability
- Must include `package.json` with `@modelcontextprotocol/sdk` and `zod`
- Server must be standalone — no imports from `@my-agent/core`

**See `skills/capability-templates/desktop-control.md` for the full MCP contract.**

## config.yaml Template

```yaml
# Non-secret configuration
model: <model-name>
voice_id: <voice-identifier>
output_format: ogg
language: en
```

Scripts read this file via relative path: `$SCRIPT_DIR/../config.yaml`
MCP servers read via relative path: `./config.yaml` (cwd is capability folder)
