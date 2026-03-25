---
name: Weekly Review
status: disabled
system: true
trigger:
  - type: schedule
    cron: "0 20 * * 0"
handler: weekly-review
model: haiku
notify: none
autonomy: full
once: false
created: "{{created_date}}"
---

# Weekly Review

Review the past week's activity and generate a weekly review document.

## Instructions

1. Read daily summaries from the past 7 days
2. Identify patterns, achievements, and blockers
3. Write to notebook/summaries/weekly/YYYY-WNN.md
4. Only include sections with data.
