---
name: Monthly Summary
status: disabled
system: true
trigger:
  - type: schedule
    cron: "0 22 1 * *"
handler: monthly-summary
model: haiku
notify: none
autonomy: full
once: false
created: "{{created_date}}"
---

# Monthly Summary

Compress the past month's weekly summaries into a monthly summary.

## Instructions

1. Read weekly summaries from the past month
2. Consolidate into sections: Month Overview, Key Achievements, Trends, Carry-Forward
3. Write to notebook/summaries/monthly/YYYY-MM.md
4. Only include sections with data.
