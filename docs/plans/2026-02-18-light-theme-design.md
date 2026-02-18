# Light Theme Design

**Date:** 2026-02-18
**Status:** Implemented

## Summary

Add Catppuccin Latte-inspired light theme alongside existing Mocha dark theme.

## Approach

CSS Custom Properties - define colors as variables, swap values based on `.light` class on `<html>`.

## Requirements (Simplified)

- Theme dropdown in Settings > Appearance section
- User choice persisted to localStorage
- No system preference detection (user explicitly chooses)

## Color Mapping

Uses soft lavender tones instead of standard Latte grays for a warmer feel.

| Token | Mocha (dark) | Latte (light - lavender) |
|-------|--------------|--------------------------|
| bg | #1e1e2e | #faf8fc |
| surface | #181825 | #f3eef7 |
| panel | #313244 | #e8e0f0 |
| card | #45475a | #ddd4e8 |
| text | #cdd6f4 | #4c4f69 |
| muted | #6c7086 | #8c8fa1 |
| blue | #89b4fa | #1e66f5 |
| purple | #cba6f7 | #8839ef |
| green | #a6e3a1 | #40a02b |
| red | #f38ba8 | #d20f39 |

## Implementation

1. ✅ Convert Tailwind config colors to CSS variables
2. ✅ Add light theme variable overrides (`:root.light`)
3. ✅ Add theme state to Alpine.js app
4. ✅ Add dropdown in Settings > Appearance
5. ✅ Wire up localStorage persistence
6. ✅ Add divider utility classes for theme-aware borders
7. ✅ Solid chat bubble colors for visibility in light mode
