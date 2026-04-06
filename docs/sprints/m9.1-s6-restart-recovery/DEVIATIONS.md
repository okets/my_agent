# M9.1-S6 Deviations Log

> Deviations from the design spec or implementation plan.

## DEV1: Disable stale once-automations instead of deleting (Approved)

**Spec says:** "Delete automation manifests where once: true and status is completed."

**Implementation:** Uses `AutomationManager.disable()` instead — no `delete()` method exists.

**Rationale:** Disabled automations don't fire. Equivalent behavior, safer (no data loss). CTO approved before execution.

