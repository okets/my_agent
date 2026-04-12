# M9.5-S6: Screenshot Pipeline — Architect Review

**Reviewer:** CTO architect session
**Date:** 2026-04-12

---

## Verdict: PASS — all decisions validated

End-to-end pipeline works: desktop screenshots and Playwright screenshots both flow through VAS, get URLs injected into tool results, and render inline in conversations. Both smoke tests passed (KWrite content and CNN automation). Tests green across both packages. All four sprint decisions are architecturally sound.

---

## Decision Validation

### D1 (revised): SDK `tool_response` shape and Anthropic API format — VALIDATED

The revised D1 correctly identifies that the SDK converts MCP image blocks to Anthropic API format (`source.data`) before passing to PostToolUse, and passes a raw content-block array (not `{ content: [...] }`). The defensive `toContentBlocks()` helper handles both shapes.

**Why this is right:** SDK runtime shapes can change. Defensive parsing protects against future SDK updates. The initial Task 0 static source trace was incomplete — smoke testing surfaced four integration bugs (DEV-3). The `tool_result` → `tool_response` field name bug is exactly the kind of thing only runtime testing catches.

**Validated.** The final implementation handles both MCP and Anthropic formats. `parseMcpToolName()` strips the SDK's `mcp__<server>__<tool>` prefix, which correctly generalizes the source inference (no hardcoded plug names).

### D2: Curation directive belongs in framework, not plug — VALIDATED

The initial placement in `desktop-x11/CAPABILITY.md` was wrong because `loadCapabilityHints()` only reads frontmatter metadata (name, health), not the body. The directive was dead weight.

**Why this is right:** The "socket vs plug" split says framework owns the socket, plug owns platform specifics. Screenshot curation is generic framework behavior — it applies to every image-producing MCP tool (desktop, Playwright, future image generation). Putting it in a plug would mean:
1. Duplicate directives across N plugs
2. No directive at all for plugs that forget it
3. Users customizing one plug accidentally override framework policy

Putting it in `assembleSystemPrompt()` and `buildWorkingNinaPrompt()` (both framework code) means it reaches both conversation brain and automation workers, and applies to any future image-producing capability automatically.

**Validated.** The implementation in `packages/core/src/prompt.ts:487` is at the correct layer.

### D3: Imperative ("MUST") beats advisory ("MAY") — VALIDATED

The first directive said "include the most relevant screenshot URL(s) as markdown images... If no screenshot is worth showing, don't include any." Brain consistently skipped screenshots even when obviously warranted.

The rewrite uses MUST language, concrete format example (`![what this shows](/api/assets/screenshots/ss-<uuid>.png)`), explicit rules (one screenshot, near top, copy URL exactly, only skip if purely textual). After this change, brain complied on first attempt.

**Why this is right:** This is a valuable framework-wide learning, not just a one-off fix. LLM system prompts compete against many pressures — token cost, conciseness, uncertainty, the rest of the prompt. Advisory language loses that competition. Prescriptive language with concrete rules wins.

**Validated.** This lesson should inform future framework directives. I'd add a design principle to the spec: "Framework-level behavioral directives to LLM brains use MUST/NEVER language with concrete examples and explicit rules. Advisory language is for capability-specific tool descriptions."

### DEV-4: `.my_agent/` file cleanup — VALIDATED

Clean. The section added and then removed after D2 moved the directive to framework level. Since `.my_agent/` is gitignored, nothing committed, so no git churn. The revert was for filesystem hygiene only. Correct.

---

## Spec Coverage

All spec requirements mapped to implementation + tests:

| Requirement | Status |
|---|---|
| `storeAndInject()` with DI store callback | Done — core doesn't import dashboard |
| Dual-format image detection (MCP + Anthropic API) | Done |
| `inferSource()` with prefix mapping | Done — unit tested |
| `parseImageMetadata()` with fallbacks | Done |
| PostToolUse hook in session-manager | Done |
| PostToolUse hook + Playwright MCP in automation-executor | Done |
| Framework curation directive | Done at framework layer (D2) |
| Ref scanner reuse (no changes) | Done — pre-existing code verified |
| Tool-name-prefix-generic design | Done — no hardcoded plug names in framework |
| Bug fix: `tool_result` → `tool_response` | Done |
| Integration tests | 5 new, all passing |
| KWrite smoke test | Passed after 4 bug fixes |
| CNN smoke test | Passed on first attempt after KWrite fixes |

---

## Deviations — All Reasonable

| # | Deviation | Verdict |
|---|---|---|
| DEV-1 | Curation moved plug → framework | Correct architectural fix, see D2 |
| DEV-2 | Advisory → imperative directive | Correct behavioral fix, see D3 |
| DEV-3 | Four SDK integration bugs | Expected — static source trace cannot fully characterize runtime |
| DEV-4 | CAPABILITY.md section revert | Cleanup artifact of DEV-1 |

All four resulted in stronger architecture, not scope creep. The sprint delivered more than the plan specified because the smoke tests forced better design decisions.

---

## Test Results

- **Core:** 347 passed, 0 failed, 7 skipped
- **Dashboard:** 1148 passed, 0 failed, 12 skipped (one pre-existing flaky browser test excluded, unrelated)
- **TypeScript:** Clean both packages
- **27 middleware tests** — all three-tier shape handling, prefix parsing, metadata parsing
- **5 integration tests** — full pipeline including automation path
- **2 smoke tests** — KWrite and CNN, both PASS

---

## Items Tracked

**FOLLOW-UPS.md has one item:**

- **UX-1:** 30-second silent gap between job card dismissal and Nina's reply start. Not blocking. Worth addressing in the next dashboard UX pass — users interpret silence as "job was lost" which defeats the point of the progress card.

This is correctly scoped out of M9.5 — it's conversation UX territory, not capability framework.

---

## Why No External Reviewer is Acceptable

The sprint review explains: CTO was hands-on throughout smoke testing via pair-browse. The bugs an external reviewer would have caught (4 SDK integration issues, layer violation, advisory language) were caught by CTO in real time.

Normally I'd push back on skipping the external review. In this case the alternative was stronger — live browser testing with the CTO watching each brain decision. That caught things static review wouldn't have (e.g., brain's reluctance to include screenshots despite the advisory directive being present in the prompt).

Accept. For future reference: this pattern (CTO pair-browse substitutes for external review) is appropriate when the sprint's success criteria require live agent behavior, not static code correctness.

---

## Architectural Wins

Three things this sprint got right that should inform future work:

1. **One generic interceptor replaces per-capability bridges.** The pre-existing `PlaywrightScreenshotBridge` will eventually be redundant. Future image-producing capabilities (image generation, chart rendering, OCR with visual output) get VAS storage for free.

2. **"Socket vs plug" applied correctly under pressure.** Initial implementation put the curation directive in the plug. When that failed (directive never reached brain), the fix restored the architectural principle rather than papering over it with plug-side workarounds.

3. **The framework directive applies to both conversation and automation.** `formatScreenshotCurationDirective()` gets included in both `assembleSystemPrompt()` (conversation brain) and `buildWorkingNinaPrompt()` (automation worker). Same behavior, two caller sites, one source of truth.

---

## Design Principle to Record

Framework-level behavioral directives to LLM brains:
- Use MUST/NEVER language, not MAY/SHOULD
- Include a concrete format example
- List explicit rules (not general guidance)
- Advisory language is for tool descriptions; prescriptive language is for behavior that the framework enforces

This belongs in the capability framework design doc as a note under Framework Middleware.

---

## Summary

M9.5-S6 ships clean. All four decisions are architecturally sound. Both smoke tests pass. Screenshot pipeline is generic framework code that benefits every image-producing MCP capability. The one follow-up (UX-1 silent gap) is correctly scoped to a future sprint. M9.5 can close.

Recommend merge.
