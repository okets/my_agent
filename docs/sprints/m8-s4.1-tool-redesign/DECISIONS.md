# M8-S4.1: Tool Redesign — Decision Log

## D1: Dropped `prompt` parameter from `fetch_image`

**Spec said:** `fetch_image({ url?, prompt? })` with future MCP image generation via `prompt`.

**Decision:** Shipped with `url` only. The `prompt` mode requires MCP marketplace integration (M9/M12) — no point adding a dead parameter now.

**Why:** YAGNI. When MCP image gen tools arrive, `fetch_image` can be extended or a new tool can be added.

## D2: Removed base64 mode from `fetch_image`

**Spec said:** Keep base64 mode in `fetch_image` for MCP image gen tools that return base64.

**Decision:** Removed it — unreachable via the MCP schema (only `url` is exposed). Dead code flagged by reviewer.

**Why:** When MCP image gen tools arrive, they'll return content blocks that the SDK handles natively. No need for a base64 passthrough in our tool.

## D3: Replaced Haiku analysis with deterministic heuristic

**Spec said:** Hook asks Haiku "does this have chartable data?" before generating.

**Decision:** Removed the Haiku opinion step. Use a heuristic instead: response has 3+ numbers AND bulleted/table structure → go straight to chart generation.

**Why:** Haiku was inconsistent — said NO for AQI daily readings, NO for temperature data. Two Haiku calls per chart (analysis + generation) was slower and less reliable than one call (generation only) with a deterministic gate.

## D4: SVG sanitization in `create_chart`

**Decision:** Added `&` → `&amp;` and `°` → `&#176;` sanitization before passing SVG to sharp.

**Why:** Haiku generates SVGs with unescaped ampersands and degree symbols, causing XML parse errors in librsvg. Discovered during WhatsApp E2E testing.

## D5: WhatsApp agentDir resolution via directory walk-up

**Decision:** Walk up from `process.cwd()` to find `.my_agent/screenshots/` instead of relying on config or env var.

**Why:** The systemd service CWD is `packages/dashboard`, so relative `.my_agent` resolved to the wrong path. Config passthrough wasn't working reliably. Walk-up is resilient to working directory changes.
