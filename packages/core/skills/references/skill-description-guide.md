# Writing Effective Skill Descriptions

The `description` field in a skill's frontmatter is the primary mechanism that determines whether the SDK invokes the skill. A bad description means the skill never triggers — a silent failure the user won't notice.

## Principles

1. **State what AND when.** Include both what the skill does and the contexts where it should trigger.
2. **Include trigger keywords.** Think about what the user would actually say. Include synonyms, casual phrasing, and edge cases.
3. **Be slightly pushy.** The SDK tends to under-trigger. Make the description a bit broader than feels necessary.
4. **Keep it under 100 words.** SDK allocates limited space for all skill descriptions combined.

## Examples

**Weak:** "Generates charts"
**Strong:** "Generate charts and visualizations from data — use when user mentions graphs, plots, dashboards, data visualization, or asks to see numbers visually, even if they don't specifically say 'chart'"

**Weak:** "Handles Jira tickets"
**Strong:** "Create, update, and search Jira tickets — use when user mentions bugs, issues, tickets, sprints, backlogs, or asks to track/file/report something in the project tracker"

**Weak:** "Formats reports"
**Strong:** "Format and structure reports with consistent styling — use when user asks for reports, summaries, write-ups, briefs, or any structured document output"

## Anti-Patterns

- **Too vague:** "Helps with things" — matches everything, helps nothing
- **Too narrow:** "Generate a Q4 sales bar chart in PNG format" — won't trigger for pie charts or Q3
- **Missing keywords:** "Data visualization" — misses "graph", "chart", "plot" which users actually say
- **No context cues:** "Jira" — doesn't mention when to use it (filing bugs vs reading boards vs sprint planning)
