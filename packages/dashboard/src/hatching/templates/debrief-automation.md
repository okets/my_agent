---
name: Debrief
status: active
trigger:
  - type: schedule
    cron: "0 8 * * *"
handler: debrief-prep
model: sonnet
notify: immediate
autonomy: full
once: false
created: "{{created_date}}"
---

# Debrief

Generate a daily briefing by reading notebook context and presenting a summary
of past activity and upcoming plans.

## Instructions

1. Read assembled notebook context (summaries, daily logs, properties, staged facts, calendar)
2. Write a briefing to notebook/operations/current-state.md with sections:
   - Today — current events, deadlines, plans
   - This Week Ahead — upcoming milestones
   - This Month Ahead — bigger picture
   - Yesterday — key events
   - Past 7 Days — weekly highlights
   - Past 30 Days — monthly highlights
3. Only include sections with data. Skip empty sections.
4. Hard cap: 3000 characters.
5. After generating: update fact staging counters.
