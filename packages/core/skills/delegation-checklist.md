---
name: delegation-checklist
description: Pre-flight checklist for delegating work via create_automation — guides field population
level: brain
---

# Delegation Checklist

Before calling `create_automation`, fill in these fields:

1. **Name:** short descriptive title
2. **Instructions:** ALL context the worker needs — it cannot see this conversation
3. **Todos:** break the work into concrete steps (required — at least one item). Each becomes a mandatory checklist item. Even simple tasks get a single-item todo.
4. **Model:** sonnet for most work, opus for complex reasoning/planning
5. **Notify:** "immediate" if user is waiting, "debrief" for background work
6. **Autonomy:** "full" for safe work, "cautious" for side effects, "review" for high-risk
7. **Job type:** "research" for research tasks, "capability_build"/"capability_modify" for capabilities
8. **Delivery:** if user wants results sent somewhere, include delivery actions

If you can't confidently fill in 1-3, interview the user first.
