---
name: Weekly Summary
status: disabled
system: true
trigger:
  - type: schedule
    cron: "0 21 * * 0"
handler: weekly-summary
model: haiku
notify: none
autonomy: full
once: false
created: "{{created_date}}"
---

# Weekly Summary

Compress the past week's daily summaries into a single weekly summary.

## Instructions

1. Read daily summaries from the past 7 days
2. Consolidate into sections: Highlights, Decisions, Carry-Forward Items
3. Write to notebook/summaries/weekly/YYYY-WNN-summary.md
4. Only include sections with data.
