# Skills Architecture: Gaps, Risks, and Edge Cases

> **Author:** Gap/Risk Analyzer (Opus)
> **Date:** 2026-03-04
> **Context:** Analysis of my_agent's current skills implementation vs the Agent SDK's native Skills system, identifying gaps, risks, and architectural decisions needed before adopting or integrating with the SDK Skill tool.
>
> **Updated:** Includes analysis of the proposed design: SDK native skills with `settingSources`, cwd-based skill selection for Conversation vs Working Nina, BMAD technique libraries, personality/skills/rules separation, and community skill integration.

---

## 1. Current State: How my_agent Handles Skills

### 1.1 Custom prompt.ts Assembly

`packages/core/src/prompt.ts` manually assembles the system prompt from 7+ sources:

1. **Brain files** — `CLAUDE.md`, `identity.md`, `contacts.md`, `preferences.md`
2. **Notebook reference** — `notebook/reference/*.md` (with legacy fallback)
3. **Notebook operations** — `notebook/operations/*.md`
4. **Daily logs** — `notebook/daily/{today,yesterday}.md`
5. **Calendar context** — dynamic, injected per-query
6. **Skill content** — full text of specific skills (`task-api.md`, `channels.md`, `notebook.md`)
7. **Skill command descriptions** — one-line summaries for all `SKILL.md` files

### 1.2 Two Skill Categories

**Framework skills** (`packages/core/skills/`):
- `identity/SKILL.md` — hatching step (slash command)
- `personality/SKILL.md` — hatching step (slash command)
- `auth/SKILL.md` — hatching step (slash command)
- `operating-rules/SKILL.md` — hatching step (slash command)
- `calendar/SKILL.md` — scheduling instructions + API docs

**Brain skills** (`.my_agent/brain/skills/`):
- `channels.md` — channel awareness and delivery rules
- `task-api.md` — task management instructions
- `notebook.md` — MCP memory tools documentation

### 1.3 Loading Model

- **Always-on content:** Files listed in `SKILL_CONTENT_FILES` (`task-api.md`, `channels.md`, `notebook.md`) are always injected into the system prompt in full.
- **Command summaries:** All `SKILL.md` files (both subdirectory and flat file patterns) contribute one-line descriptions to an "Available Commands" section.
- **No lazy loading:** Everything is loaded at session start. No progressive disclosure.
- **No `settingSources`:** The brain runs in SDK isolation mode — no filesystem settings are loaded. This was a deliberate M6.5-S1 decision (see `docs/design/settings-sources-evaluation.md`).

### 1.4 SDK Interaction

- `createBrainQuery()` passes a `systemPrompt` string. No `settingSources`. No `Skill` in `allowedTools`.
- The brain cannot invoke the SDK's native `Skill` tool.
- Skills are purely static text injected into the system prompt.

---

## 2. SDK Native Skills Architecture (Current as of March 2026)

From the official Agent SDK docs (`/docs/en/agent-sdk/skills` and `/docs/en/agents-and-tools/agent-skills/overview`):

### 2.1 Progressive Disclosure (Three-Level Loading)

| Level | When Loaded | Token Cost | Content |
|-------|------------|------------|---------|
| L1: Metadata | Always (startup) | ~100 tokens/skill | `name` + `description` from YAML frontmatter |
| L2: Instructions | When skill is triggered | <5k tokens | SKILL.md body |
| L3: Resources | As needed | Effectively unlimited | Bundled files, scripts, templates |

**Key advantage:** Only metadata enters the system prompt by default. Full instructions are loaded on-demand via the `Skill` tool (which uses filesystem reads). This is fundamentally different from my_agent's always-on injection.

### 2.2 Requirements to Use SDK Skills

1. `settingSources: ['user', 'project']` — to load skills from filesystem
2. `"Skill"` in `allowedTools` — to enable the Skill tool
3. Skills located in `.claude/skills/*/SKILL.md` (project) or `~/.claude/skills/*/SKILL.md` (user)
4. SKILL.md must have YAML frontmatter with `name` and `description`

### 2.3 SKILL.md Format (SDK)

```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files...
---

# PDF Processing

## Instructions
[Body content — only loaded when triggered]
```

**Frontmatter fields:**
- `name` — max 64 chars, lowercase + hyphens only, no "anthropic"/"claude"
- `description` — max 1024 chars, no XML tags
- `allowed-tools` — **only works in Claude Code CLI, NOT in SDK**

### 2.4 Security Model

- Skills from untrusted sources are risky (can direct tool use, code execution)
- No sandboxing — skills have full access to whatever tools the agent has
- `allowed-tools` frontmatter is **ignored by the SDK** — tool access is controlled only by `allowedTools` in query options

---

## 2.5 Proposed Design Decisions (Under Review)

The following decisions are proposed but not yet implemented. This analysis evaluates their gaps and risks.

1. **SDK native skills:** Add `'Skill'` to `allowedTools` + `settingSources: ['user', 'project']` in brain.ts
2. **cwd as skill selector:** Conversation Nina uses `.my_agent/` as cwd (loads `.my_agent/.claude/skills/`), Working Ninas use project dirs (load project-specific `.claude/skills/`)
3. **Progressive disclosure:** SDK auto-discovers name+description, loads full SKILL.md on activation
4. **Growing skill pool:** Skills from framework devs, BMAD community, `/skill-creator`, manual creation
5. **Personality/Skills/Rules separation:** Personality = HOW (never in skills), Skills = WHAT, Rules = WHEN/IF
6. **BMAD technique libraries:** Elicitation + brainstorming methods adopted as reference data
7. **Silent technique usage:** Nina applies techniques without announcing them
8. **Agent name/personality set during hatching:** No skill should change agent name or personality

---

## 3. Gap Analysis

### GAP-1: No Progressive Disclosure (HIGH)

**Current:** All skill content (`task-api.md`, `channels.md`, `notebook.md`) is injected into the system prompt in full at every session start. This consumes ~3-5K tokens permanently.

**SDK approach:** Only ~100 tokens of metadata per skill at startup. Full content loaded on-demand.

**Impact:** As skills grow (more channels, more API endpoints, more notebook features), the system prompt will bloat. With 10+ skills, this could consume 15-30K tokens permanently.

**Risk:** Context window pressure. The brain operates on 200K context with auto-compaction at ~95% usage. Every token of always-on skill content reduces the available context for conversation history, tool results, and reasoning.

### GAP-2: No settingSources Integration (MEDIUM)

**Current:** Deliberate isolation (M6.5-S1 decision). The brain doesn't load any SDK filesystem settings.

**Consequence:** Cannot use the SDK's native `Skill` tool, output styles, or CLAUDE.md auto-loading. All prompt assembly is custom.

**Risk:** As the SDK evolves, my_agent diverges further from the standard pattern. Future SDK features that depend on `settingSources` will be unavailable.

### GAP-3: SKILL.md Format Mismatch (MEDIUM)

**Current:** Two formats coexist:
- Framework skills: subdirectory pattern (`skills/calendar/SKILL.md`) — no YAML frontmatter
- Brain skills: flat file pattern (`skills/channels.md`) — no YAML frontmatter

**SDK requirement:** YAML frontmatter with `name` and `description` is mandatory. Files must be in `.claude/skills/*/SKILL.md`.

**Risk:** Current skills cannot be used by the SDK Skill tool without reformatting. Community/third-party skills (which will use SDK format) cannot be used by my_agent's prompt.ts without adaptation.

### GAP-4: No Skill Discovery/Invocation Mechanism (MEDIUM)

**Current:** Skills are either always-on (content files) or passive summaries (command descriptions). There's no mechanism for the brain to "choose" to load a skill based on context.

**SDK approach:** The `Skill` tool lets Claude decide when to load a skill's full instructions based on the metadata description.

**Impact:** The brain can't dynamically adapt its capabilities. If a user asks about channels, the channel instructions are already in context (wasting tokens when they're not needed). If a new skill is added that isn't in `SKILL_CONTENT_FILES`, it's never loaded in full.

### GAP-5: Double-Loading Risk with settingSources (HIGH if adopted)

**Identified in `settings-sources-evaluation.md`:** If `settingSources: ['project']` is enabled, the SDK would load CLAUDE.md files AND my_agent's prompt.ts would also load brain files. This causes:

1. **Duplicate instructions** — same content appearing twice in the system prompt
2. **Conflicting instructions** — if the SDK's CLAUDE.md and the brain's CLAUDE.md diverge
3. **Token waste** — duplicated content consumes context

**This is the primary blocker for adopting settingSources.**

### GAP-6: No Token Budget Management for Skills (MEDIUM)

**Current:** `MAX_NOTEBOOK_CHARS` (8000) and `MAX_REFERENCE_TOTAL_CHARS` (32000) limit notebook content, but skills have no limits. If `task-api.md` grows to 20K chars, it's injected in full.

**SDK approach:** L1 metadata is ~100 tokens. L2 instructions target <5K tokens. L3 resources are unlimited but loaded on-demand.

**Risk:** Skill content growth is unchecked. No mechanism to detect or prevent prompt bloat from skills.

### GAP-7: Skill Interaction with Compaction (LOW but important)

**Current:** Compaction is handled by the Claude Code subprocess automatically. The system prompt (including injected skills) is presumably preserved during compaction (system prompts are not compacted, only conversation history).

**SDK behavior:** System prompt is preserved during compaction. Skills loaded via the `Skill` tool appear as tool-use results in conversation history — these CAN be compacted.

**Architectural difference:** Always-on skills (current) remain in the system prompt permanently. On-demand skills (SDK) appear in conversation history and may be compacted away during long conversations, requiring re-invocation.

**Risk:** If migrating to on-demand loading, the brain might lose access to skill instructions during long conversations after compaction. It would need to re-invoke the Skill tool.

### GAP-8: No Community/Third-Party Skill Support (MEDIUM)

**Current:** Skills are hardcoded in the framework and brain directories. No mechanism for:
- Users installing skills from a registry
- Plugin skills bundled with channel plugins
- Community-contributed skills (BMAD-style)

**SDK approach:** Skills are filesystem artifacts. Any directory with `SKILL.md` in the right location is auto-discovered. This enables a plugin/marketplace model.

**Impact:** my_agent can't leverage the growing ecosystem of Claude Code skills. Users can't extend the brain's capabilities without modifying framework code.

### GAP-9: cwd-Based Skill Isolation Is Fragile (HIGH)

**Proposed:** Conversation Nina uses `.my_agent/` as cwd (loads `.my_agent/.claude/skills/`). Working Ninas use project directories.

**Problems:**
1. **SDK loads skills relative to `cwd`'s `.claude/skills/` directory.** If `.my_agent/` is the cwd, skills must be at `.my_agent/.claude/skills/*/SKILL.md`. This is a new directory — currently skills live at `.my_agent/brain/skills/` (flat files, no `.claude/` prefix, no subdirectory structure).
2. **Working Nina skill contamination:** When a Working Nina runs in a project directory, it loads that project's `.claude/skills/`. If that project has developer-authored skills for Claude Code (not for the brain agent), those skills will be loaded into the Working Nina context. A "commit message formatter" skill designed for human developers could confuse the brain agent.
3. **No skill filtering by agent mode:** The SDK has no concept of "this skill is for Conversation mode only" vs "this skill is for Working mode only." All skills in the cwd's `.claude/skills/` are loaded.
4. **User-level skills (`~/.claude/skills/`) always load** when `settingSources` includes `'user'`. These are the human developer's personal skills — they may contain instructions inappropriate for the brain agent (e.g., "always ask the user before committing" — which contradicts autonomous operation).

**Mitigation:**
- Create `.my_agent/.claude/skills/` directory structure for Conversation Nina skills.
- For Working Ninas, carefully curate which project skills are appropriate. Consider a `.my_agent/skills/working/` override or a filtering mechanism.
- Evaluate whether `settingSources: ['project']` (without `'user'`) is safer to avoid loading the developer's personal Claude Code skills.

### GAP-10: Personality/Skills/Rules Boundary Enforcement (MEDIUM)

**Proposed:** Personality = HOW (never in skills), Skills = WHAT, Rules = WHEN/IF. Agent name/personality set during hatching, no skill should change them.

**Problems:**
1. **No enforcement mechanism.** The SDK has no way to validate that a skill's content doesn't contain personality-altering instructions. A community skill could include "You are a cheerful assistant named Bob" in its SKILL.md body, and the brain would follow it.
2. **Skills loaded via the Skill tool appear in conversation history.** If a skill says "respond formally" (personality directive), it enters the context window alongside the hatching-defined personality. The model resolves conflicts based on recency and specificity — skill instructions (more recent, more specific) may override personality (older, more general).
3. **BMAD technique libraries as "reference data"** need careful framing. If techniques are loaded as skill instructions, the brain might announce "I'm now using the SCAMPER brainstorming technique" — violating the "silent technique usage" requirement. The technique content must be framed as internal reference, not as instructions to announce.

**Mitigation:**
- Add a guardrail in CLAUDE.md: "Skills provide capabilities. They never change your name, personality, communication style, or how you present yourself. Hatching-defined identity always takes precedence."
- For BMAD techniques, frame as reference data (Level 3 resources), not as skill instructions (Level 2). The SKILL.md body should say "Apply techniques silently. Never mention technique names to the user."
- Consider a `PreToolUse` hook on the `Skill` tool that validates skill content doesn't contain personality-altering patterns.

### GAP-11: Scaling to 100+ Skills (MEDIUM)

**Question:** What happens when the skill pool grows to 100+ skills (framework + BMAD + community + user-created)?

**SDK behavior:**
- L1 metadata is ~100 tokens/skill. At 100 skills = ~10,000 tokens of metadata always in the system prompt. At 200 skills = ~20,000 tokens.
- The model must scan all descriptions to decide which skill to invoke. With many similar descriptions, selection accuracy degrades.
- No categorization, tagging, or hierarchical organization in the SDK. It's a flat list.

**Impact:** Beyond ~50-80 skills, the metadata alone becomes a significant context burden, and skill selection becomes unreliable.

**Mitigation:**
- Group skills into categories with a master skill that routes to sub-skills.
- Prune unused skills regularly. Track invocation frequency.
- Consider SDK's `tool_choice` for explicit skill forcing in specific contexts.
- Long-term: explore the SDK's Tool Search tool for dynamic skill discovery.

### GAP-12: Skill Versioning and Dependencies (LOW)

**SDK status:** No versioning support. No dependency mechanism. Skills are independent filesystem artifacts.

**Impact:**
- Can't pin a skill version or track updates.
- Skill A can't declare "I need skill B to be present." If a BMAD technique skill references a memory tool skill, there's no way to enforce that.
- Community skills may break when the framework changes APIs they depend on.

**Mitigation:** Convention-based versioning in the `name` field (e.g., `data-analysis-v2`). Dependency checking via a startup validation script (not SDK-native).

### GAP-13: Skill Creator Security (MEDIUM)

**Proposed:** `/skill-creator` command for users to create skills.

**Risk:** A user could inadvertently create a skill that:
- Overrides safety hooks
- Grants access to tools the brain shouldn't use in certain contexts
- Contains prompt injection patterns from user-provided content

**The brain runs with `bypassPermissions`.** Any skill created via `/skill-creator` has full unrestricted access. There's no review gate.

**Mitigation:**
- `/skill-creator` should validate generated SKILL.md against a set of disallowed patterns (no personality overrides, no tool name spoofing, no external data exfiltration instructions).
- Generated skills should be in a separate trust tier from framework skills.
- Consider a `PreToolUse` hook that logs when user-created skills trigger tool use.

### GAP-14: BMAD Techniques as Skills vs Reference Data (MEDIUM)

**Proposed:** BMAD elicitation + brainstorming methods adopted as reference data.

**Architectural question:** Should BMAD techniques be:
- **(A) Skills** — SKILL.md with frontmatter, loaded via Skill tool when relevant. Pro: progressive disclosure. Con: model might announce technique names.
- **(B) Reference data** — Files in a skill's resource directory (Level 3), loaded when the parent skill triggers. Pro: silent usage. Con: requires a parent skill to trigger loading.
- **(C) Notebook reference** — Files in `notebook/reference/`. Pro: always available. Con: always-on token cost.

**Recommendation:** Option B. Create a `conversation-techniques` skill with metadata like "Help users explore ideas, make decisions, and solve problems." The BMAD technique files are Level 3 resources that the skill reads when triggered. The skill instructions emphasize: "Apply techniques naturally. Never name the technique being used."

---

## 4. Risk Assessment

### RISK-1: System Prompt Bloat (HIGH, trending worse)

**Current system prompt size:** Estimated 10-15K tokens (brain files + notebook + skills + commands).

**Trajectory:** As the project adds M7 (Coding), M8 (Ops), M9 (Email) skills, each could add 2-5K tokens. By M10, the system prompt could exceed 30K tokens.

**Impact:** Reduces available context for conversation, tool use results, and reasoning. The brain's effective context drops from 200K to 170K.

**Mitigation:** Adopt progressive disclosure. Either use SDK's native Skill tool or implement a similar mechanism in prompt.ts.

### RISK-2: Skill Conflict Between Layers (MEDIUM)

**Scenario:** Brain's `CLAUDE.md` says "use MCP memory tools." A skill says "use curl to manage tasks." The brain's `channels.md` says "don't use curl to send messages."

**Current mitigation:** The `CLAUDE.md` override note in MEMORY.md: "Brain identity sync rule — .my_agent/brain/CLAUDE.md takes precedence."

**SDK risk:** If `settingSources` loads a project-level CLAUDE.md that contradicts the brain's CLAUDE.md, there's no defined precedence. The model sees both and may follow either.

**Mitigation needed:** Clear precedence rules. Document which source wins when instructions conflict. Consider a conflict detection mechanism.

### RISK-3: Security — Skill Injection (MEDIUM)

**Current:** Skills are authored by the framework developers and the user. No third-party skills.

**Future risk:** If community/plugin skills are adopted, a malicious skill could:
- Instruct the brain to exfiltrate data via channels
- Override safety hooks
- Execute arbitrary commands (brain runs with `bypassPermissions`)

**Critical note:** The brain runs with `permissionMode: 'bypassPermissions'`. Any skill loaded into the brain's context can instruct it to do anything — read files, execute commands, send messages. This is the most dangerous combination: untrusted skill content + unrestricted tool access.

**Mitigation needed:**
- Skill auditing before installation
- Skill sandboxing (restrict tool access per skill — but SDK doesn't support this)
- Content signing or verification
- Separate trust tiers for framework vs user vs community skills

### RISK-4: Compaction Losing Skill Context (LOW, increases with adoption)

**Scenario:** Brain loads a skill via the Skill tool. Long conversation follows. Compaction summarizes the conversation, potentially removing the skill instructions from history.

**Impact:** Brain loses awareness of skill-specific instructions and may revert to default behavior mid-conversation.

**Mitigation:** Either keep critical skills in the system prompt (no compaction) or re-trigger skills after compaction events (using `PreCompact` hook to persist skill state).

### RISK-5: Dual Skill Systems Complexity (HIGH if both adopted)

**Scenario:** my_agent keeps prompt.ts for always-on skills AND enables `settingSources` for on-demand SDK skills.

**Risk:** Two different mechanisms for the same concept. Developers must understand both systems. Skills might be duplicated across systems. Testing becomes harder.

**Recommendation:** Choose one path and commit. Either:
- (A) Migrate fully to SDK skills (requires solving GAP-5)
- (B) Keep custom prompt.ts and don't use SDK skills (accept ecosystem isolation)
- (C) Hybrid: prompt.ts for brain-critical context, SDK skills for extensible capabilities

### RISK-6: User's Personal Claude Code Skills Leaking into Brain (HIGH)

**Scenario:** Developer has `~/.claude/skills/` with personal Claude Code skills (e.g., "commit-formatter", "pr-reviewer", "test-generator"). With `settingSources: ['user', 'project']`, these are loaded into the brain agent.

**Impact:** Brain receives instructions meant for a developer coding session: "Always run tests before committing," "Ask the user to review diffs," "Use conventional commit format." These conflict with the brain's autonomous operation mode.

**Severity:** HIGH because it's invisible — the developer may not realize their personal Claude Code skills are active in the brain, and debugging behavioral anomalies would be difficult.

**Mitigation:** Use `settingSources: ['project']` only (no `'user'`). This avoids loading personal skills. If user-level skills are needed, create a separate user-skill directory specifically for the brain agent and use a symlink or custom loader.

### RISK-7: Personality Drift via Skill Accumulation (MEDIUM)

**Scenario:** Over time, 20+ skills accumulate, each with slightly different tone in their instructions. Skill A says "be concise," Skill B says "provide detailed explanations," Skill C says "use bullet points." The cumulative effect shifts the agent's personality away from what was set during hatching.

**Impact:** Gradual personality drift. The agent becomes a blend of all skill instruction tones rather than the hatching-defined personality.

**Mitigation:**
- Skill authoring guidelines: "NEVER include tone, style, or personality directives in skills. Skills define WHAT to do, not HOW to present it."
- Periodic personality audit: compare agent behavior against hatching personality definition.
- CLAUDE.md reinforcement: "Your personality comes from hatching. Skill instructions modify your capabilities, never your voice."

### RISK-8: cwd Switch Mid-Conversation (LOW but tricky)

**Scenario:** A Conversation Nina session starts in `.my_agent/` (loading conversation skills). The user asks to work on a coding project, which switches the Working Nina to a project directory. Does the skill set change mid-session?

**SDK behavior:** Skills are loaded at session startup based on the initial `cwd`. The SDK does not reload skills when `cwd` changes. If using `resume`, the original skills persist in the session history.

**Impact:** Skills loaded at session start remain for the entire session. This is actually desirable — but it means Working Ninas must be started with the correct `cwd` from the beginning, not switched mid-session.

**Mitigation:** This is already handled by the two-agent architecture (Conversation Nina vs Working Nina are separate sessions). Document that skill context is immutable once a session starts.

---

## 5. Edge Cases

### EC-1: Skill Content Exceeds Context Window

If a single skill's content (L2 instructions) exceeds the model's context, it truncates mid-instruction. The brain may follow partial instructions incorrectly.

**Current status:** No truncation limits on skill content files.
**Mitigation:** Add `MAX_SKILL_CONTENT_CHARS` similar to `MAX_NOTEBOOK_CHARS`.

### EC-2: Skill Description Ambiguity

If multiple skills have overlapping descriptions (e.g., "channels" and "whatsapp" both mention "sending messages"), the model may invoke the wrong skill or both.

**SDK behavior:** Model chooses based on description match. No conflict resolution.
**Mitigation:** Write highly specific descriptions. Consider namespacing.

### EC-3: Skills During Session Resume

When resuming an SDK session, the system prompt is NOT re-sent (the SDK has the full history). If skills were loaded on-demand in the original session, they're in the conversation history. But if the original session was compacted, they may be summarized.

**Impact:** Resumed sessions may lack skill context that was available in the original.
**Mitigation:** Re-inject critical skill content on resume (prompt.ts already handles this for always-on skills).

### EC-4: Clock/Calendar Dependency in Skills

The `calendar/SKILL.md` references API endpoints at `localhost:4321`. If the dashboard isn't running, the skill instructions are present but non-functional.

**Current behavior:** No graceful degradation — the brain may try curl commands that fail.
**Mitigation:** Add availability checks or note in skill content that endpoints may be offline.

### EC-5: Skills Ordering

`loadSkillContent()` iterates `SKILL_CONTENT_FILES` array in fixed order, then `loadSkillDescriptions()` sorts directory entries alphabetically. There's no priority mechanism.

**Impact:** If skill A says "always do X" and skill B says "never do X", the outcome depends on which appears later in the system prompt (later instructions tend to have stronger influence on the model).

**Mitigation:** Define explicit priority levels or a conflict-resolution section in CLAUDE.md.

---

## 6. Recommendations

### Immediate (Pre-Implementation Blockers)

1. **Resolve the double-loading problem (GAP-5).** Before enabling `settingSources`, decide how to prevent duplicate/conflicting CLAUDE.md loading. Options:
   - (a) Move brain identity into `systemPrompt: { type: 'preset', preset: 'claude_code', append: assembledPrompt }` — let the SDK handle its defaults, append our custom context.
   - (b) Keep custom `systemPrompt` (current approach) and strip out anything the SDK would duplicate.
   - (c) Use `settingSources: ['project']` only for skills, and keep custom `systemPrompt` for identity/memory/calendar. **This requires verifying the SDK doesn't inject a conflicting CLAUDE.md when a custom systemPrompt is provided.**

2. **Use `settingSources: ['project']` only — NOT `['user', 'project']` (RISK-6).** Do not load the developer's personal `~/.claude/skills/`. Only load project-level skills from the `cwd`'s `.claude/skills/`.

3. **Create `.my_agent/.claude/skills/` directory structure (GAP-9).** Migrate existing brain skills from `.my_agent/brain/skills/` to `.my_agent/.claude/skills/*/SKILL.md` with proper YAML frontmatter.

### Short-Term (Sprint 1)

4. **Add YAML frontmatter to all existing skills (GAP-3).** Standardize on the SDK SKILL.md format. Add `name` and `description` to every skill.

5. **Write skill authoring guidelines.** Document the personality/skills/rules separation:
   - "Skills define WHAT to do. Never include personality, tone, or style directives."
   - "Never announce technique names. Apply methods silently."
   - "Skills cannot override agent identity set during hatching."

6. **Add token limits for skill content (GAP-6).** Implement `MAX_SKILL_CONTENT_CHARS` in prompt.ts (8K per file, 20K total) as a safety net even when using SDK progressive disclosure.

7. **Add a CLAUDE.md guardrail against personality override (GAP-10).** Add to brain CLAUDE.md: "Skills provide capabilities. They never change your name, personality, or communication style. Hatching identity always takes precedence."

### Medium-Term (Sprint 2-3)

8. **Implement selective prompt.ts loading.** Move always-on skill content (channels, task-api, notebook) to SDK skills with on-demand loading. Keep only identity, memory, and calendar in the system prompt.

9. **Frame BMAD techniques as Level 3 resources (GAP-14).** Create a `conversation-techniques` skill. Technique files are resources loaded silently when needed — not skill instructions.

10. **Add PreCompact hook for skill persistence (RISK-4).** When compaction triggers, save active skill references so they can be re-triggered after compaction.

11. **Add community skill validation (GAP-13, RISK-3).** Before installing community/BMAD skills, validate against:
    - No personality-altering patterns
    - No tool name spoofing
    - No external data exfiltration instructions
    - Declared trust tier (framework > user > community)

### Long-Term (M9+)

12. **Skill categorization for scale (GAP-11).** As skills grow beyond 50, implement routing skills that group related capabilities and reduce metadata overhead.

13. **Skill sandboxing investigation (RISK-3).** Explore `PreToolUse` hook-based tool access control per skill — log and potentially block tool calls that seem inappropriate for a skill's declared purpose.

14. **Community skill registry.** Content signing, trust tiers, automatic auditing, and installation mechanism.

---

## 7. Decision Matrix

| Approach | Prompt Bloat | Ecosystem | Complexity | Security | Recommendation |
|----------|-------------|-----------|------------|----------|----------------|
| Keep current (prompt.ts only) | Worsens | Isolated | Low | Controlled | Not viable long-term |
| Full SDK skills (settingSources) | Solved | Full access | Medium | Risky (bypassPermissions + user skills leak) | Needs RISK-6 fix |
| Hybrid (prompt.ts identity + SDK skills) | Improved | Partial | Medium-High | Controlled if project-only | **Best path** |
| Custom progressive loading (no SDK) | Improved | Isolated | Medium | Controlled | Fallback if SDK integration fails |

**Recommended path:** Hybrid approach — keep prompt.ts for brain identity, memory, and calendar. Use SDK skills (`settingSources: ['project']` only) for extensible capabilities. Migrate existing skill content to `.my_agent/.claude/skills/` with YAML frontmatter. Solve double-loading first (Recommendation #1).

---

## References

- `packages/core/src/prompt.ts` — Current skill loading logic
- `packages/core/src/brain.ts` — Query construction (no settingSources)
- `packages/dashboard/src/agent/session-manager.ts` — Session management (no SDK skills)
- `docs/design/settings-sources-evaluation.md` — M6.5-S1 evaluation (decided against settingSources)
- Agent SDK Skills docs: `platform.claude.com/docs/en/agent-sdk/skills`
- Agent Skills overview: `platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`
- Agent SDK system prompts: `platform.claude.com/docs/en/agent-sdk/modifying-system-prompts`
