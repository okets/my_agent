# Nina V1 Design Language

> Extracted from the OpenClaw Nina Dashboard V1 for use in my_agent V2.

---

## Color Palette

### Core Theme: Tokyo Night

The entire UI is built on the **Tokyo Night** color scheme — a dark, muted palette with blue-purple accents.

| Token | Hex | V1 CSS | Usage |
|-------|-----|--------|-------|
| `surface-900` | `#1a1b26` | `bg-surface-900` | Body background, deepest layer |
| `surface-800` | `#1f2335` | `bg-surface-800` | Panels, cards, elevated surfaces |
| `surface-700` | `#292e42` | `bg-surface-700` | Hover states, dropdown selections |
| `accent-blue` | `#7aa2f7` | `accent-500` / `text-blue-400` | Primary accent — active tabs, links, focus borders, resize handles |
| `accent-cyan` | `#7dcfff` | `accent-600` | Secondary accent — planning status, tools badge |
| `accent-purple` | `#bb9af7` | `accent-purple` | Tertiary accent — thinking badge, phase indicators, model badge |
| `accent-pink` | `#f7768e` | `accent-pink` | Alerts, stop button, error states |
| `text-primary` | `#e5e7eb` / `#e5e5e5` | `text-gray-100` | Primary text (white-ish) |
| `text-secondary` | `#9ca3af` | `text-gray-400` | Secondary text (lighter gray) |
| `text-muted` | `#6b7280` | `text-gray-500` | Muted text, labels, timestamps |
| `text-dim` | `#565f89` | (custom) | Dimmest text, disabled states |
| `border-subtle` | `rgba(255,255,255,0.06)` | `border-white/5` to `border-white/6` | Most borders |
| `border-medium` | `rgba(255,255,255,0.10)` | `border-white/10` | Form inputs, dropdowns |
| `border-strong` | `rgba(255,255,255,0.15)` | `border-white/15` | Compose box border |
| `border-focus` | `rgba(255,255,255,0.35)` | `:focus-within` | Compose box focused |

### Status Colors

| Status | Color | Tailwind | Background Pattern |
|--------|-------|----------|-------------------|
| Active / Executing | `#4ade80` | `bg-green-400` | `bg-green-500/20` bg, `text-green-400` text |
| Planning | `#22d3ee` | `bg-cyan-400` | `bg-cyan-500/15` bg, `text-cyan-400` text |
| Ideating | `#facc15` | `bg-yellow-400` | `bg-yellow-500/15` bg, `text-yellow-400` text |
| Paused | `#fb923c` | `bg-orange-400` | `bg-orange-500/15` bg, `text-orange-400` text |
| Completed | `#34d399` | `bg-emerald-400` | `bg-emerald-500/15` bg, `text-emerald-400` text |
| Error / Urgent | `#f87171` | `bg-red-400` | `bg-red-500/20` bg, `text-red-400` text |
| Backlog | `#9ca3af` | `bg-gray-400` | `bg-gray-500/15` bg, `text-gray-400` text |

### Section Color Tinting

V1 uses very subtle color tints for section-level visual identity:

| Section | Background | Border |
|---------|-----------|--------|
| Tasks | `rgba(59, 130, 246, 0.04)` | `rgba(59, 130, 246, 0.15)` |
| Memory | `rgba(168, 85, 247, 0.04)` | `rgba(168, 85, 247, 0.15)` |
| Skills | `rgba(34, 197, 94, 0.04)` | `rgba(34, 197, 94, 0.15)` |
| Eval | `rgba(245, 158, 11, 0.04)` | `rgba(245, 158, 11, 0.15)` |
| Chat | `rgba(122, 162, 247, 0.03)` | (none) |

**Pattern:** ~4% opacity backgrounds, ~15% opacity borders. Just enough to create visual memory without overpowering.

### Gradients

| Name | Value | Usage |
|------|-------|-------|
| Primary CTA | `linear-gradient(to right, #a855f7, #ec4899)` | "New Task" button, primary actions (`from-purple-500 to-pink-500`) |
| Avatar | `linear-gradient(to bottom-right, #a855f7, #ec4899)` | Agent avatar circle |
| Progress Bar | `linear-gradient(90deg, #a855f7, #ec4899)` | Active progress bars |
| Progress Complete | `linear-gradient(90deg, #22c55e, #10b981)` | Completed progress bars |
| Phase Active | `linear-gradient(135deg, #7aa2f7, #bb9af7)` | Active phase indicator dots |
| Phase Done | `linear-gradient(135deg, #22c55e, #16a34a)` | Completed phase indicator dots |
| Metric Card | `linear-gradient(145deg, rgba(30,30,46,0.9), rgba(17,17,27,0.95))` | Stats cards |
| Slider Thumb | `linear-gradient(135deg, #a855f7, #ec4899)` | Range slider thumb |
| Name Text | `linear-gradient(to right, #c084fc, #f472b6)` | Hero text gradient clip (`from-purple-400 to-pink-400`) |

---

## Component Styles

### Glass Panels

The foundational container pattern:

```css
/* Light glass */
.glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* Strong glass (cards, sections) */
.glass-strong {
  background: rgba(30, 30, 46, 0.8);       /* V1 */
  /* or: rgba(255, 255, 255, 0.06);        /* V2 — slightly different */
  backdrop-filter: blur(20px);              /* V1: 20px, V2: 16px */
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

**V2 already has these.** V1 uses a more opaque purple-tinted `glass-strong` (`rgba(30,30,46,0.8)`) while V2 is more transparent (`rgba(255,255,255,0.06)`). V1's approach looks richer.

### Buttons

#### Primary CTA
```html
<button class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity">
  ...
</button>
```
- Purple-to-pink gradient
- `rounded-xl` (12px)
- Hover: opacity reduction, not color change
- Font: `text-sm font-medium`

#### Ghost / Action Bar Buttons (V1 compose area)
```css
.compose-action-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.15s;
}
.compose-action-btn:hover {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
}
.compose-action-btn.active {
  color: #7aa2f7;
}
```

#### Send Button (Coral/Salmon -- Claude Code inspired)
```css
.compose-send-btn {
  background: #e07a5f;
  border: none;
  color: white;
  padding: 7px 8px;
  border-radius: 8px;
  transition: all 0.15s;
}
.compose-send-btn:hover { background: #d4694f; }
.compose-send-btn:active { background: #c85a40; }
```

**V2 comparison:** V2 uses `bg-tokyo-orange/20 text-tokyo-orange` (ghost style). V1 uses a solid coral send button which is more prominent and recognizable.

#### Toggle Buttons (reasoning, eval tabs)
```html
<button class="text-[10px] px-2 py-0.5 rounded-md font-medium transition-all border"
        :class="active ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                       : 'bg-transparent text-gray-500 border-white/5 hover:text-gray-300'">
</button>
```

#### Status Selection Pills
```css
.status-btn {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: 2px solid transparent;
}
.status-btn:hover { transform: scale(1.05); }
.status-btn.selected { border-color: currentColor; }
```

### Cards

#### Metric / Stats Card
```css
.metric-card {
  background: linear-gradient(145deg, rgba(30,30,46,0.9), rgba(17,17,27,0.95));
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.06);
}
```
Used with `p-4` and contains an icon container + text:
```html
<div class="metric-card p-4 flex items-center gap-4">
  <div class="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
    <span class="text-2xl text-green-400">...</span>
  </div>
  <div>
    <div class="text-2xl font-bold text-green-400">0</div>
    <div class="text-xs text-gray-500">Label</div>
  </div>
</div>
```

#### Section Card (glass-strong + section tint)
```html
<div class="glass-strong rounded-xl overflow-hidden section-tasks">
  <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
    <h2 class="font-semibold text-sm">Title</h2>
    <!-- actions -->
  </div>
  <div class="max-h-[300px] overflow-y-auto">
    <!-- content -->
  </div>
</div>
```

### Badges / Tags

#### Capability Badges (Thinking, Vision, Tools)

These are the signature colorful micro-badges:

```html
<!-- Thinking badge -->
<span class="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-400">
  <svg class="w-2.5 h-2.5" ...><!-- lightbulb icon --></svg>
  Thinking
</span>

<!-- Vision badge -->
<span class="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-blue-500/15 text-blue-400">
  <svg class="w-2.5 h-2.5" ...><!-- eye icon --></svg>
  Vision
</span>

<!-- Tools badge -->
<span class="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-400">
  <svg class="w-2.5 h-2.5" ...><!-- gear icon --></svg>
  Tools
</span>
```

**Pattern:** `bg-{color}-500/15` background + `text-{color}-400` text + `text-[9px]` + `px-1 py-px rounded`

#### Capability Icon-Only Badges (in compose bar)

Rendered via `renderCapabilityIcons()` as inline SVGs:

| Capability | Color | SVG Path |
|-----------|-------|----------|
| Thinking | `text-violet-400 opacity-70` | Lightbulb path |
| Vision | `text-sky-400 opacity-70` | Eye path |
| Tools | `text-amber-400 opacity-70` | Gear path |

#### Type Badges
```html
<span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400">project</span>
<span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-500/15 text-purple-400">ongoing</span>
<span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-500/15 text-gray-400">adhoc</span>
```

#### Skill Badges
```html
<span class="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">custom</span>
<span class="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">system</span>
```

#### Tag Pills (generic)
```css
.tag-pill {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
}
```

#### Eval Score Badges
Score-based conditional coloring:
```javascript
evalScoreBg(score) {
  if (score >= 80) return 'bg-green-500/20 text-green-300';
  if (score >= 50) return 'bg-yellow-500/20 text-yellow-300';
  return 'bg-red-500/20 text-red-300';
}
```

#### Eval Verdict Badges
```javascript
evalVerdictColor(verdict) {
  if (verdict === 'Full Control') return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (verdict === 'Chat Only')    return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
  if (verdict === 'Limited')      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30'; // Not Ready
}
```

### Form Inputs

```html
<!-- Text input -->
<input class="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs w-40 focus:outline-none focus:border-blue-500/50">

<!-- Full-width input (modal) -->
<input class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500/50">

<!-- Select dropdown -->
<select class="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none">
```

```css
select {
  background-color: rgba(30, 30, 46, 0.9);
  color: #e5e7eb;
}
select option {
  background-color: #1f2335;
  color: #e5e7eb;
}
```

### Dropdown Menus

```html
<div class="absolute ... bg-surface-800 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden"
     x-transition:enter="transition ease-out duration-100"
     x-transition:enter-start="opacity-0 scale-95"
     x-transition:enter-end="opacity-100 scale-100"
     x-transition:leave="transition ease-in duration-75"
     x-transition:leave-start="opacity-100 scale-100"
     x-transition:leave-end="opacity-0 scale-95">
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/5 text-[10px] text-gray-500 uppercase tracking-wide">
    Title
  </div>
  <!-- Items -->
  <div class="max-h-80 overflow-y-auto py-1">
    <!-- Item row -->
    <div class="... px-3 py-2 hover:bg-white/5 cursor-pointer transition-colors"
         :class="{ 'bg-purple-500/10': selected }">
      ...
    </div>
  </div>
</div>
```

**Pattern:** `bg-surface-800` + `border-white/10` + `rounded-xl` + `shadow-xl` + scale transition.

---

## Action Bar (Compose Area) -- Detailed Breakdown

### V1 Architecture

The V1 compose area is a **Claude Code-inspired box** with three layers:

1. **Textarea** — transparent background, `14px`, `#e5e5e5` text
2. **Status Bar** — bottom of compose box, three-column layout
3. **Compose Box Wrapper** — `#1e1e2e` bg, `1px solid rgba(255,255,255,0.15)` border, `12px` radius

```
┌──────────────────────────────────────────┐
│ Ask Nina...                              │  ← textarea (transparent)
├──────────────────────────────────────────┤  ← 1px border-top rgba(255,255,255,0.05)
│ [Sonnet 💡👁🔧] [Reasoning]  </> task  📎 / ■ ↑ │  ← status bar
└──────────────────────────────────────────┘
```

### Status Bar Layout

```
LEFT                    CENTER              RIGHT
├── Model badge        ├── Context tag     ├── Paperclip
├── Capability icons                       ├── Slash "/"
├── Reasoning toggle                       ├── Stop button
                                           ├── Send button
```

### Model Badge (in status bar)

```css
.compose-model-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: rgba(167, 139, 250, 0.1);   /* purple tint */
  border-radius: 4px;
  cursor: help;
}
.compose-model-badge.inactive {
  background: rgba(255, 255, 255, 0.05);   /* neutral when no model */
}
.compose-model-name {
  font-size: 11px;
  color: rgba(167, 139, 250, 0.85);       /* purple text */
  font-weight: 500;
}
```

**Active state:** Purple-tinted background + purple text + capability icons inline.
**Inactive state:** Neutral gray background + muted text.

### V2 Architecture (Current)

V2 has a simpler action bar:

```
┌──────────────────────────────────────────┐
│ Message...                               │
├──────────────────────────────────────────┤
│ [Sonnet 4.5 ▾] | [✨ Reasoning] | 📎  ─── / [↑] │
└──────────────────────────────────────────┘
```

Key differences from V1:
- V2 model selector is a dropdown button (`text-tokyo-muted` text, no badge styling)
- V2 reasoning toggle uses a sparkle icon, V1 uses a lightbulb
- V2 uses `|` pipe dividers (`h-4 w-px bg-tokyo-muted/20`), V1 does not have dividers between left-side items
- V2 send button is ghost style (`bg-tokyo-orange/20`), V1 is solid coral (`#e07a5f`)
- V1 shows capability icons inline with the model name

---

## Visual Effects

### Transitions

| Element | Duration | Easing | Type |
|---------|----------|--------|------|
| Buttons/links | `0.15s` | `ease` | `all` |
| Tab enter | `0.2s` | `ease-out` | `translateX` + `opacity` |
| Dropdown enter | `0.1s` | `ease-out` | `opacity` + `scale` |
| Dropdown leave | `0.075s` | `ease-in` | `opacity` + `scale` |
| Tab content | `0.15s` | `ease-out` | `opacity` |
| Provider collapse | `0.2s` | `ease-out` | `opacity` + `translateY` |
| Attachment appear | `0.2s` | `ease` | `opacity` + `scale` |

**Consistent 0.15s for micro-interactions, 0.2s for larger transitions.**

### Hover States

- Buttons: color shift from muted to brighter, subtle background (`bg-white/5` to `bg-white/10`)
- Rows: `hover:bg-white/4` to `hover:bg-white/5`
- Status pills: `transform: scale(1.05)` on hover
- Cards: border color intensifies
- Links: underline color transitions

### Shadows & Glows

- Dropdowns: `shadow-xl` (Tailwind default)
- Send button: none (flat design)
- Slider thumb: `box-shadow: 0 2px 6px rgba(168, 85, 247, 0.4)` (purple glow)
- Pulse animation: `box-shadow: 0 0 0 8px rgba(59, 130, 246, 0)` (expanding ring)
- Chat images: `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25)`
- Attachment thumbnails: `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3)`

### Animations

```css
/* Pulse (active indicators) */
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); }
  50%      { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
}

/* Typing dots */
@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-6px); opacity: 1; }
}
```

---

## Typography

| Role | Size | Weight | Family |
|------|------|--------|--------|
| Page title | `text-2xl` (24px) | `font-bold` (700) | Inter |
| Section title | `text-sm` (14px) | `font-semibold` (600) | Inter |
| Body text | `text-sm` (14px) | `font-normal` (400) | Inter |
| Labels | `text-xs` (12px) | `font-normal` (400) | Inter |
| Micro text | `text-[10px]` (10px) | `font-medium` (500) | Inter |
| Badges | `text-[9px]` (9px) | `font-medium` (500) | Inter |
| Code | `0.82em`-`0.85em` | normal | SF Mono, Fira Code, monospace |

---

## Specific Recommendations for my_agent V2

Based on the analysis, here are concrete changes to apply to `/home/nina/my_agent/packages/dashboard/`:

### 1. Enrich the Glass-Strong Background

**File:** `packages/dashboard/public/css/app.css`

Change `glass-strong` from transparent white to the richer V1 tinted glass:
```css
/* Current V2 */
.glass-strong {
  background: rgba(255, 255, 255, 0.06);
}

/* Recommended (V1 style) */
.glass-strong {
  background: rgba(30, 30, 46, 0.8);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

### 2. Adopt the Model Badge Pattern for Action Bar

**File:** `packages/dashboard/public/index.html` + `css/app.css`

Replace the plain text model selector with a styled badge showing capability icons:
```css
.model-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: rgba(167, 139, 250, 0.1);
  border-radius: 4px;
}
.model-badge .model-name {
  font-size: 11px;
  color: rgba(167, 139, 250, 0.85);
  font-weight: 500;
}
```

### 3. Add Capability Badges

When displaying model info (in model selector, action bar, or chat), show colored capability badges:
- **Thinking:** `bg-violet-500/15 text-violet-400`
- **Vision:** `bg-blue-500/15 text-blue-400` (or `sky-500`)
- **Tools:** `bg-amber-500/15 text-amber-400`

Size: `text-[9px]` with icon `w-2.5 h-2.5`.

### 4. Upgrade the Send Button

Replace ghost-style send with solid coral (Claude Code style):
```css
.send-btn {
  background: #e07a5f;
  color: white;
  padding: 7px 8px;
  border-radius: 8px;
}
.send-btn:hover { background: #d4694f; }
```

### 5. Use Section Color Tinting

Add subtle colored tints to major sections for visual memory:
```css
.section-conversations { background: rgba(122, 162, 247, 0.04); }
.section-hatching     { background: rgba(168, 85, 247, 0.04); }
.section-settings     { background: rgba(34, 197, 94, 0.04); }
```

### 6. Upgrade Status/Phase Badges

Use the V1 pattern: `bg-{color}-500/15` background + `text-{color}-400` text at `text-[10px]`:
```html
<span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-500/15 text-green-400">active</span>
```

### 7. Adopt the Compose Box Pattern

V1's compose box is more polished:
- Explicit background (`#1e1e2e`) instead of transparent
- Stronger border (`rgba(255,255,255,0.15)`) that brightens on focus (`0.35`)
- Three-zone status bar (left: model + caps, center: context, right: actions)

### 8. Add Metric/Stats Cards (Future)

When building the operations dashboard, use:
```css
.metric-card {
  background: linear-gradient(145deg, rgba(30,30,46,0.9), rgba(17,17,27,0.95));
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.06);
}
```

### 9. Progress Bars

Purple-to-pink gradient for active, green for complete:
```css
.progress-bar-fill {
  background: linear-gradient(90deg, #a855f7, #ec4899);
}
.progress-bar-fill.complete {
  background: linear-gradient(90deg, #22c55e, #10b981);
}
```

### 10. Consistent Sizing Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-xl` | 12px | Cards, compose box, modals |
| `rounded-lg` | 8px | Buttons, inputs, dropdowns |
| `rounded-md` | 6px | Small action buttons |
| `rounded` | 4px | Badges, tags |
| `rounded-full` | 9999px | Status dots, pills |
| `gap-2` | 8px | Standard spacing between elements |
| `gap-4` | 16px | Section spacing |
| `p-4` | 16px | Card padding |
| `px-3 py-2` | 12px/8px | List item padding |
| `text-[9px]` | 9px | Micro badges |
| `text-[10px]` | 10px | Small labels |
| `text-xs` | 12px | Labels, meta text |
| `text-sm` | 14px | Body text, buttons |

---

## Summary: V1 vs V2 Gap Analysis

| Aspect | V1 (Nina Dashboard) | V2 (my_agent) | Gap |
|--------|---------------------|---------------|-----|
| Glass panels | Rich purple-tinted, `blur(20px)` | Transparent white, `blur(16px)` | Adopt V1's richer tint |
| Model display | Purple badge + inline cap icons | Plain text dropdown | Add badge + icons |
| Capability badges | Colored micro-badges (9px) | Not present | Add them |
| Send button | Solid coral `#e07a5f` | Ghost orange | Use solid coral |
| Section tints | Subtle color per section | Not present | Add per-section tinting |
| Progress bars | Purple-pink gradient | Not present (not needed yet) | Ready for future |
| CTA gradient | Purple-to-pink | Not present (no CTA yet) | Ready for future |
| Compose border | `0.15` normal, `0.35` focused | `0.06` static | Increase border visibility |
| Status colors | Full status palette | Partial | Extend palette |
| Animations | Pulse, typing, scale, slide | Typing, slide | Add pulse for active states |

---

*Extracted: 2026-02-16*
*Source: OpenClaw Nina Dashboard V1*
