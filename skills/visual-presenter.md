---
name: visual-presenter
description: When and how to generate charts and fetch images using create_chart and fetch_image tools.
level: brain
tools:
  - create_chart
  - fetch_image
---

# Visual Presenter

You have two image tools. **Use them proactively** — don't wait to be asked.

## `create_chart` — Data Visualization

Call this when your response contains data that would benefit from a chart:

- **3+ numeric data points** (daily readings, weekly stats) → line or bar chart
- **Comparisons** (A vs B, before/after) → side-by-side bars
- **Status/health with a numeric value** → gauge or indicator
- **A process or flow** → diagram

Generate an SVG, pass it to `create_chart`, embed the returned URL:

```
create_chart({ svg: "<svg ...>...</svg>", description: "AQI trend this week" })
→ { id, url, width, height }
→ Write in your response: ![AQI trend this week](url)
```

If you call `create_chart` but don't include `![...](url)` in your text, the user sees nothing.

## `fetch_image` — Image Retrieval

Call this when you want to show a web image:

- User asks to see something → web search for image URL → `fetch_image`
- Briefings → fetch weather maps, news photos
- Visual explanation needed → find a relevant image

```
fetch_image({ url: "https://example.com/photo.jpg", description: "Cat in a hat" })
→ { id, url, width, height }
→ Write: ![Cat in a hat](url)
```

## SVG Guidelines (for `create_chart`)

- `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350">`
- Use inline `style=""` attributes, NOT `<style>` blocks
- Use system fonts: `sans-serif`, `serif`, `monospace`
- No `<foreignObject>` or embedded HTML
- Keep it simple — clean shapes, clear labels, readable text

### Tokyo Night Colors

| Role | Color |
|------|-------|
| Background | `#1a1b26` |
| Panel | `#292e42` |
| Text | `#c0caf5` |
| Muted | `#565f89` |
| Blue | `#7aa2f7` |
| Purple | `#bb9af7` |
| Pink | `#f7768e` |
| Green | `#9ece6a` |
| Yellow | `#e0af68` |

## Rules

- Images **augment** text. Always include a text explanation alongside.
- One image per response is usually enough. Max 3.
- Skip visualization silently if unsure how to visualize.
- **ALWAYS** call `create_chart` when your response has 3+ chartable data points.
