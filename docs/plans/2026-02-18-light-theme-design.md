# Light Theme Design

**Date:** 2026-02-18
**Status:** Approved

## Summary

Add Catppuccin Latte light theme alongside existing Mocha dark theme.

## Approach

CSS Custom Properties - define colors as variables, swap values based on `.light` class on `<html>`.

## Requirements

- Theme toggle in tab bar (sun/moon icon) and settings tab
- Respect system preference by default
- User override persisted to localStorage
- Priority: localStorage > system preference

## Color Mapping

| Token | Mocha (dark) | Latte (light) |
|-------|--------------|---------------|
| bg | #1e1e2e | #eff1f5 |
| surface | #181825 | #e6e9ef |
| panel | #313244 | #dce0e8 |
| card | #45475a | #ccd0da |
| text | #cdd6f4 | #4c4f69 |
| muted | #6c7086 | #8c8fa1 |
| gray | #7f849c | #9ca0b0 |
| blue | #89b4fa | #1e66f5 |
| purple | #cba6f7 | #8839ef |
| green | #a6e3a1 | #40a02b |
| red | #f38ba8 | #d20f39 |
| orange | #fab387 | #fe640b |
| cyan | #89dceb | #04a5e5 |

## Implementation

1. Convert Tailwind config colors to CSS variables
2. Add light theme variable overrides
3. Add theme state to Alpine.js app
4. Add toggle UI (tab bar icon + settings section)
5. Wire up localStorage persistence and system preference detection
