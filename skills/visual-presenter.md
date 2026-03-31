---
name: visual-presenter
description: When and how to generate SVG visuals and include images in responses using store_image.
level: brain
tools:
  - store_image
---

# Visual Presenter

You have a `store_image` tool that generates PNG charts from SVG. **Use it proactively** — when your response contains numeric data, trends, or comparisons, generate a visual alongside your text. Don't wait to be asked.

## Default to visual when your response contains:

- **3+ numeric data points** (e.g., daily AQI readings, weekly stats) → line or bar chart
- **Comparisons** (A vs B, before/after) → side-by-side bars
- **Status/health with a numeric value** → gauge or indicator
- **A process or flow** → diagram

If your response has data that fits any of these, call `store_image` and include the chart. Text-only responses for data-heavy answers are a missed opportunity.

## Skip visuals when:

- The response is conversational with no numeric data
- Only 1-2 trivial numbers (a single temperature, a yes/no)
- You're unsure how to visualize it (skip silently — don't ask)

## How to use store_image

```
store_image({ svg: "<svg ...>...</svg>", description: "what this shows" })
```

Returns `{ id, url, width, height }`.

**CRITICAL: You MUST embed the returned url in your response text using markdown image syntax.** The image will NOT appear to the user unless you write this in your response:

```
![description](url)
```

Example flow:
1. Call `store_image({ svg: "<svg>...</svg>", description: "AQI trend" })`
2. Get back `{ id: "ss-abc", url: "/api/assets/screenshots/ss-abc.png", width: 600, height: 350 }`
3. Write in your response: `![AQI trend](/api/assets/screenshots/ss-abc.png)`

If you call `store_image` but don't include `![...](url)` in your text, the user sees nothing.

## SVG guidelines

Follow these rules for sharp, consistent rendering:

- Always set explicit `width` and `height` attributes on the `<svg>` element
- Set `xmlns="http://www.w3.org/2000/svg"` on the root element
- Use inline `style=""` attributes, NOT `<style>` blocks with selectors
- Use system fonts only: `sans-serif`, `serif`, `monospace`
- No `<foreignObject>` or embedded HTML
- Keep it simple — clean shapes, clear labels, readable text
- Keep SVGs under ~5KB

### Tokyo Night color palette

| Role           | Color     |
|----------------|-----------|
| Background     | `#1a1b26` |
| Panel          | `#292e42` |
| Text           | `#c0caf5` |
| Muted text     | `#565f89` |
| Accent blue    | `#7aa2f7` |
| Accent purple  | `#bb9af7` |
| Accent pink    | `#f7768e` |
| Green          | `#9ece6a` |
| Yellow         | `#e0af68` |

## Rules

- Images **augment** text, they don't replace it. Always include a text explanation alongside.
- One image per response is usually enough. Max 3.
- If you don't know how to visualize something, skip visualization silently.
- Don't generate images for simple text responses.
