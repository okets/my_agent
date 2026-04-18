# S14 Decisions

## D1: Factory pattern for ResilienceCopy

`createResilienceCopy(registry: CapabilityRegistry): ResilienceCopy` replaces the module-level `defaultCopy` singleton.

**Why:** Follows the established DI pattern from S10 (`CapabilityInvoker`) and S12 (`createMcpCapabilityCfrDetector`). The factory receives a live registry at boot, enabling registry-aware copy (multi-instance suffix, per-type fallback action) without module-level state or circular imports. Tests pass a stub registry.

**How applied:** `app.resilienceCopy = createResilienceCopy(registry)` at boot, beside the existing capability wiring. Field is initialized with an empty-registry stub so the field is always non-null.

---

## D2: Frontmatter-driven fallback_action

`fallback_action` is sourced from CAPABILITY.md frontmatter, surfaced via `registry.getFallbackAction(type)`.

**Why:** CLAUDE.md core principle: "Markdown is source of truth." Allows plug authors to override the fallback per-plug without code changes. Consistent with how `multi_instance`, `icon`, and `requires.env` are declared.

**How applied:** Scanner reads `data.fallback_action` into `cap.fallbackAction`. `getFallbackAction()` walks the registry and returns the first match or `"try again in a moment"` when unset.

---

## D3: FRIENDLY_NAMES stays hardcoded in S14

The `FRIENDLY_NAMES` table in `resilience-messages.ts` is not migrated to frontmatter in this sprint.

**Why:** Scoped to Phase 2. Migration to frontmatter is tracked in FU-1 for Phase 3.

**How applied:** Added `browser-control` → `"browser"` and `desktop-control` → `"desktop control"` entries. Exported for the universal-coverage test.

---

## D4: WELL_KNOWN_MULTI_INSTANCE safety net in isMultiInstance

`registry.isMultiInstance(type)` falls back to `WELL_KNOWN_MULTI_INSTANCE.has(type)` when no matching capability is loaded.

**Why:** Ensures correct multi-instance detection for capabilities that haven't been rescanned after the S14 scanner changes, and for any test stub that omits `multiInstance` from the capability object.

---

## D5: SurrenderReason extended to "surrender-cooldown"

The `SurrenderReason` union was extended to include `"surrender-cooldown"` in this sprint.

**Why:** The orchestrator already emits `AckKind = "surrender-cooldown"`, but `emitAck` in app.ts was routing it to `"iteration-3"` instead. The type gap caused incorrect user-facing copy. Added the proper branch: `rc.surrender(failure, "surrender-cooldown")`.

---

## D6: terminal-fixed AckKind bug fixed in emitAck switch

`AckKind = "terminal-fixed"` (wired in S13) was silently falling through to the `"budget"` branch in the `emitAck` switch.

**Why:** A missing `else if` branch. The orchestrator emits `"terminal-fixed"` via `dispatchReverify` (S13), but the switch had no handler for it. Fixed by adding the `terminal-fixed` → `rc.terminalAck(failure)` branch and a `console.warn` fallback for any future unhandled kinds.

---

## D7: Plug-level fallback_action overrides template-level

When multiple instances of the same type are registered, `getFallbackAction` returns the first match across all instances (first-wins). This means a plug-level `fallback_action` declared in a specific CAPABILITY.md takes precedence over the template default — provided it appears first in the registry's insertion order.

**Why:** `fallback_action` is a type-level property; all instances of the same type should declare the same value. The first-wins semantic is intentional and matches how `isMultiInstance` works. If instances diverge, the registry load order determines which value wins — this is acceptable since divergence is an authoring error.
