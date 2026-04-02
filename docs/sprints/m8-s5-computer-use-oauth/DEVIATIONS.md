# Deviations: M8-S5 Computer Use OAuth Fix

## Deviation: DISPLAY environment variable

**Type:** Addition
**Planned:** Not in scope — assumed X11 environment was correctly configured
**Actual:** Had to add `DISPLAY=:10` and `XAUTHORITY=/home/nina/.Xauthority` to the systemd service file. The dashboard was inheriting `DISPLAY=:10.0` from SSH X11 forwarding, which is the wrong display for the XRDP session.
**Reason:** The XRDP desktop runs on `:10`, not `:0` (physical seat). Without correct DISPLAY, `maim` and `xdotool` cannot access the X server.
**Impact:** None on other sprints. Systemd service file change is infrastructure-only.
**Recommendation:** Keep

## Deviation: Depleted API key poisoning Agent SDK

**Type:** Change
**Planned:** Comment out API key, test OAuth path
**Actual:** Discovered that having a depleted `ANTHROPIC_API_KEY` in `.env` caused the Agent SDK to use it (zero credits = empty responses). Had to comment it out permanently. The brain and all background queries (TaskExtractor, abbreviation) were silently failing.
**Reason:** The Agent SDK prefers `ANTHROPIC_API_KEY` over `CLAUDE_CODE_OAUTH_TOKEN` when both are set.
**Impact:** `.env` now only has `CLAUDE_CODE_OAUTH_TOKEN`. All API calls route through OAuth.
**Recommendation:** Keep — this is the correct state for Max subscription.
