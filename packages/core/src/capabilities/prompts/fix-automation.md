# Fix Automation — {{capabilityType}} (Attempt {{attemptNumber}}/3)

## Failure Context

- **Capability:** {{capabilityName}} (type: {{capabilityType}})
- **Symptom:** {{symptom}}
- **Detail:** {{detail}}

## Previous Attempts

{{#each previousAttempts}}
### Attempt {{attempt}}
- **Hypothesis:** {{hypothesis}}
- **Change made:** {{change}}
- **Verification result:** {{verificationResult}}
- **Failure mode:** {{failureMode}}
- **Next hypothesis:** {{nextHypothesis}}
{{/each}}

## Your Task

Diagnose and fix the {{capabilityType}} capability. The fix has failed {{previousAttempts.length}} time(s). Use the previous attempt history above to form a better hypothesis.

## Constraints — READ CAREFULLY

1. **Do NOT run `systemctl`, `service`, `pkill`, or any process-management command.** The framework hot-reloads capabilities when their files change. A restart is never the right fix.
2. **Do NOT read from `<agentDir>/conversations/`**. The orchestrator handles re-verification against the user's actual data. Your job is to fix the capability so it works.
3. **Your smoke test uses a synthetic fixture** in `packages/core/tests/fixtures/capabilities/`. The orchestrator will run the real re-verification after you finish.
4. **Do NOT declare success based on configuration checks alone.** Run the actual script against the fixture and confirm it produces valid output.

## Required Deliverables

Write `deliverable.md` in your run directory with YAML frontmatter:

---
change_type: config | script | deps | env
test_result: pass | fail
surface_required_for_hotreload: false
hypothesis_confirmed: true | false
summary: one-line description of what you changed
---

Then the body: what you changed, what the test showed, what the next hypothesis should be if it failed.
