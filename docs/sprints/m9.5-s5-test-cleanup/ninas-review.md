# Nina's Desktop Control Tool Review

**Date:** 2026-04-11
**Context:** Used tools to locate and read an open KWrite document on the desktop.

---

## 1. Which tools did I actually use?

- `desktop_screenshot` — to see the screen state
- `desktop_info(windows)` — to confirm KWrite was open but minimized
- `desktop_key(super)` — accidental; I pressed the Super key trying to surface KWrite, which wasn't the right move
- `desktop_click` — to click the KWrite taskbar button and bring it into focus
- `desktop_screenshot` (again) — to read the content after KWrite opened

---

## 2. Were any tools confusing or unnecessary?

Yes — the `desktop_key(super)` call was a mistake. I was trying to bring KWrite to the foreground but reached for a keyboard shortcut instead of the right tool. What I actually needed was a **"focus window by ID"** tool. I had the window ID from `desktop_info` (`0x0400000c`) but had no way to use it to raise/focus that window directly. So I fumbled with the taskbar instead.

Also: `desktop_click` throwing a type error for string coordinates (instead of numbers) was a friction point — minor, but caused an extra round-trip.

---

## 3. Was anything missing?

The biggest gap: **no "focus/raise window by ID or title" tool.** Once `desktop_info` gives me window IDs, I should be able to do `focus_window("0x0400000c")` or `focus_window("KWrite")`. Right now there's a knowledge gap between "I know the window exists" and "I can bring it forward."

Second gap: **no way to read text from a region programmatically.** I got lucky that KWrite's content was legible in the screenshot. For smaller fonts, rotated text, or dense UI, I'd have to guess. An **OCR tool** would close that gap reliably.

---

## 4. Was the coordinate system intuitive?

Mostly, but with one frustration: the screenshot is displayed at scaled-down resolution in my context, but clicks are in the original resolution. I'm essentially estimating pixel positions on a compressed image. I clicked (421, 849) and it mapped to (560, 1129) — that scaling is silent and I had no way to know the ratio ahead of time. A tool that reports `display_scale` or shows actual resolution would help me click more accurately on the first try.

---

## 5. Would these optional tools have been useful?

| Tool | Verdict |
|------|---------|
| **OCR** | Yes — high value. Text extraction without depending on screenshot readability |
| **find_element** | Yes — high value. "Find the KWrite window button in the taskbar" is more reliable than coordinate-guessing |
| **window_screenshot** | Yes — focused screenshot of just KWrite instead of full screen would've been cleaner and faster |
| **drag** | Low priority for this task, but useful for reordering lists, resizing panels |
| **diff_check** | Not relevant here, but potentially useful for monitoring a document for changes over time |

The three I'd actually reach for regularly: `window_screenshot`, `find_element`, `OCR`. They'd cover the most common failure modes I ran into today.
