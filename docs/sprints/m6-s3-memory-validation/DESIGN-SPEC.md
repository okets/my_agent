# Visual Fix Design Spec

**Sprint:** M6-S3 Visual Hotfix
**Date:** 2026-02-25
**Status:** Implementation

---

## Color Palette (Dark Mode)

Replace current Catppuccin Mocha with softer Tokyo Night-inspired palette:

```css
:root {
  /* Base backgrounds - softer, NOT pitch black */
  --color-bg: #1a1b26;        /* was #1e1e2e - main background */
  --color-surface: #1e1e2e;   /* was #181825 - elevated surfaces */
  --color-crust: #1f2335;     /* was #11111b - NO MORE PITCH BLACK */
  --color-panel: #24283b;     /* was #313244 - panels, popovers */
  --color-card: #2a2e42;      /* was #45475a - cards, inputs */

  /* Text */
  --color-text: #c0caf5;      /* was #cdd6f4 - primary text */
  --color-muted: #565f89;     /* was #6c7086 - secondary text */
  --color-gray: #6c7086;      /* was #7f849c - disabled text */

  /* Accents - keep vibrant */
  --color-blue: #7aa2f7;      /* was #89b4fa */
  --color-purple: #bb9af7;    /* was #cba6f7 */
  --color-green: #9ece6a;     /* was #a6e3a1 */
  --color-red: #f7768e;       /* was #f38ba8 */
  --color-orange: #ff9e64;    /* was #fab387 */
  --color-cyan: #7dcfff;      /* was #89dceb */

  /* Borders - subtle */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-muted: rgba(255, 255, 255, 0.08);
  --border-accent: rgba(122, 162, 247, 0.3);
}
```

---

## Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Badges, small buttons |
| `--radius-md` | 10px | Cards, timeline items, inputs |
| `--radius-lg` | 12px | Panels, popovers, modals |
| `--radius-xl` | 16px | Main containers, large cards |
| `--radius-pill` | 9999px | Pills, status badges |

---

## Shadow Scale

```css
:root {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-elevated: 0 4px 20px rgba(0, 0, 0, 0.5);
}
```

---

## Component Specs

### Tab Bar

```css
.tab-bar {
  background: var(--color-surface);  /* was --color-crust (#11111b) */
  border-bottom: 1px solid var(--border-subtle);
}

.tab-bar button {
  border-radius: 8px 8px 0 0;  /* rounded top corners */
  margin: 4px 2px 0;
  padding: 8px 12px;
}

.tab-bar button.active {
  background: var(--color-bg);
  border: 1px solid var(--border-muted);
  border-bottom: none;
}

.tab-bar button:not(.active) {
  background: transparent;
  color: var(--color-muted);
}

.tab-bar button:not(.active):hover {
  background: rgba(255, 255, 255, 0.05);
}
```

### Timeline Widget

```css
/* Timeline container */
.timeline-section {
  background: var(--color-panel);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-muted);
}

/* Timeline header */
.timeline-header {
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--color-muted);
}

/* Vertical timeline line */
.timeline-line {
  border-left: 2px solid var(--color-card);
  margin-left: 8px;
  padding-left: 20px;
}

/* Timeline item dots */
.timeline-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  position: absolute;
  left: -6px;
}

.timeline-dot.pending { background: var(--color-orange); }
.timeline-dot.event { background: var(--color-blue); }
.timeline-dot.completed { background: var(--color-green); }

/* Timeline item card */
.timeline-item {
  background: var(--color-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 8px;
}

.timeline-item:hover {
  border-color: var(--border-muted);
  background: rgba(42, 46, 66, 0.8);
}

/* TODAY badge */
.today-badge {
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
}

/* Type badges */
.type-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
}

.type-badge.task {
  background: rgba(158, 206, 106, 0.15);
  color: var(--color-green);
}

.type-badge.event {
  background: rgba(122, 162, 247, 0.15);
  color: var(--color-blue);
}

/* NOW marker */
.now-marker {
  color: var(--color-red);
  font-size: 11px;
  font-weight: 600;
}

.now-marker-line {
  height: 2px;
  background: var(--color-red);
  flex: 1;
}
```

### Mobile Settings Popover

```css
/* Popover container */
.mobile-popover {
  background: var(--color-panel);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-muted);
  box-shadow: var(--shadow-lg);
}

/* Section cards inside popover */
.settings-card {
  background: var(--color-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 12px;
}

/* Dropdowns */
.settings-select {
  background: var(--color-bg);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}
```

### Mobile Chat Bar (Elevated)

```css
/* Chat bar must be elevated with rounded corners */
.mobile-chat-bar {
  background: var(--color-panel);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border: 1px solid var(--border-muted);
  border-bottom: none;
  box-shadow: var(--shadow-elevated);
  padding: 12px 16px;
  margin: 0 8px;
}

/* Input inside chat bar */
.mobile-chat-input {
  background: var(--color-bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 14px;
}
```

---

## Mobile Viewport Fix

```javascript
// Add to app.js - handles zoom lock issue
function handleViewportReset() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    setTimeout(() => {
      viewport.content = 'width=device-width, initial-scale=1.0';
    }, 100);
  }
  document.body.style.minHeight = window.innerHeight + 'px';
}

window.addEventListener('orientationchange', handleViewportReset);
window.addEventListener('resize', debounce(handleViewportReset, 100));
```

---

## Haptic Feedback

```javascript
// Add to app.js - haptic feedback for enabled buttons
function initHaptics() {
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button && !button.disabled && navigator.vibrate) {
      navigator.vibrate(10); // 10ms subtle pulse
    }
  });
}

// Call on DOM ready
document.addEventListener('DOMContentLoaded', initHaptics);
```

---

## Implementation Checklist

- [ ] Update color variables in app.css
- [ ] Update tab bar styles
- [ ] Update timeline styles
- [ ] Update mobile popover styles
- [ ] Add elevated mobile chat bar
- [ ] Add viewport reset handlers
- [ ] Add haptic feedback
- [ ] Test dark mode (desktop + mobile)
- [ ] Test light mode (desktop + mobile)
