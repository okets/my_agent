# Sprint M1-S4: Authentication

> **Status:** Complete
> **Sprint:** 4 (final for Milestone 1)
> **Date:** 2026-02-13

---

## Goal

Implement auth setup so users can configure API key or Claude subscription during hatching, stored in `.my_agent/auth.json`, with env var override. After this sprint, M1 is complete.

---

## Tasks

- [x] **T1: Auth resolution module (`src/auth.ts`)**
  - `resolveAuth(agentDir)` — resolution order: env var → auth.json → error
  - `readAuthFile(agentDir)` — reads `.my_agent/auth.json`
  - `writeAuthFile(agentDir, profile)` — writes auth profile
  - Auth profile types: `api_key` and `setup_token`
  - Token validation: `sk-ant-oat01-` prefix + 80+ char length for setup tokens
  - Sets appropriate env var (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`) at runtime

- [x] **T2: Auth hatching step (`src/hatching/steps/auth.ts`)**
  - Check for existing env vars first → if found, confirm and skip
  - Ask: "API key (pay-per-use) or Claude subscription (Pro/Max)?"
  - Subscription path: guide user to run `claude setup-token`, validate prefix + length
  - API key path: prompt for key
  - Store in `.my_agent/auth.json` as active profile
  - Implements HatchingStep interface

- [x] **T3: Auth skill (`skills/auth/SKILL.md`)**
  - `/my-agent:auth` command description
  - Re-run auth setup anytime

- [x] **T4: Wire auth into brain.ts**
  - Replace direct env var check with `resolveAuth()`
  - Call `resolveAuth()` before creating queries
  - Set env var from auth.json profile if not already set

- [x] **T5: Wire auth step into hatching sequence**
  - Add auth step to `requiredSteps` in `hatching/index.ts` (after personality)
  - Import and register the step

- [x] **T6: Verify**
  - TypeScript compilation clean
  - Prettier formatting
  - All imports consistent

---

## Design Reference

See `docs/design.md` Section 9: Authentication for the full specification.

## Auth File Format

```json
{
  "version": 1,
  "activeProfile": "default",
  "profiles": {
    "default": {
      "provider": "anthropic",
      "method": "setup_token",
      "token": "sk-ant-oat01-..."
    }
  }
}
```

## Resolution Order

1. `ANTHROPIC_API_KEY` env var → use directly
2. `CLAUDE_CODE_OAUTH_TOKEN` env var → use directly
3. `.my_agent/auth.json` active profile → set appropriate env var
4. Error: "No auth configured. Run /my-agent:auth"
