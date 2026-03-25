---
name: Daily Summary
status: active
system: true
trigger:
  - type: schedule
    cron: "0 23 * * *"
handler: daily-summary
model: haiku
notify: none
autonomy: full
once: false
created: "{{created_date}}"
---

# Daily Summary

Compress today's daily log into a structured summary.

## Instructions

1. Read today's daily log
2. Summarize into sections: Key Events, Decisions Made, Open Items
3. Write to notebook/summaries/daily/YYYY-MM-DD.md
4. Only include sections with data.
