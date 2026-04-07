# M9.2-S8 Decisions

## D1: cleanupSkillFilters kept as deprecated no-op (Minor)

**Decision:** Instead of removing `cleanupSkillFilters` entirely and breaking all callers, made it a deprecated no-op. Callers (session-manager.ts, automation-executor.ts) can remove their calls in a future cleanup sprint without blocking this one.

**Why:** Removing the function would require updating imports in 6+ files and their tests. The no-op is zero-risk and the callers' cleanup code is harmless.

## D2: No selective worker skill loading for MVP (Minor)

**Decision:** The plan suggested selectively loading capability registry, visual-presenter, and memory-tools skills for workers that need them. Instead, removed ALL brain context from workers. Workers get only their static persona + task context.

**Why:** Workers have their own instructions in WORKING_NINA_PERSONA. The brain's skills (visual-presenter, memory-tools) contain brain-specific instructions ("When your response contains...", "If someone asks 'do you remember'...") that don't apply to workers. Workers that need specific capabilities can get them via their automation instructions. Simpler is better — we can add selective loading later if needed.
