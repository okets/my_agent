# Navigable Timeline Design

> **Status:** Approved for Implementation
> **Sprint:** M5-S10 (dedicated sprint)
> **Related:** homepage-unified-timeline.md
> **Quick fix in place:** Phase 1 partially complete (past 24h visible)

## Vision

The Timeline is **the central navigation metaphor** for all task activity. It's not just a list of upcoming items — it's a **temporal archive** that lets users:

1. **See what's happening** (present)
2. **Review what happened** (past)
3. **Preview what's coming** (future)

Think of it like a **scrollable river of time** — scroll up to see the past, scroll down to see the future, with "now" as the anchor point.

## Current State (Quick Fix)

As of M5-S9, a quick fix was implemented:
- Timeline shows past 24 hours of completed tasks
- Visual states for completed (✓ checkmark, muted opacity, "Done" badge)
- Inline "Now" marker between past and future items
- Date separators for multi-day view

**Files modified:**
- `packages/dashboard/public/js/app.js` — `timelineItems` getter
- `packages/dashboard/public/index.html` — Timeline item template

**Remaining work:** Full redesign with prominent placement, infinite scroll, rich features.

## Problem with Current Design

Even with the quick fix, issues remain:
- Timeline competes for space with Notebook, Channels, Chats sections
- No pagination — loads everything in memory
- No expansion to see task details
- No search or filtering
- Limited time range (24h past, 7 days future)

## Target Design: Hero Timeline

### Homepage Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard                                              [🔍 Search] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                      T I M E L I N E                            ││
│  │                                                                 ││
│  │  ─── Yesterday, Feb 21 ─────────────────────                    ││
│  │  14:00  ✓ Generated weekly report              [Task] [expand]  ││
│  │  16:30  ✓ Team standup meeting                 [Event]          ││
│  │                                                                 ││
│  │  ─── Today, Feb 22 ──────────────────────────                   ││
│  │  09:00  ✓ Morning briefing                     [Task]           ││
│  │  13:49  ✓ Send urgent WhatsApp to Hanan        [Task]           ││
│  │         └─ Completed • 1 min • WhatsApp sent                    ││
│  │                                                                 ││
│  │  ════════════════ NOW 6:45 PM ════════════════                  ││
│  │                                                                 ││
│  │  19:00  ○ Review PR #142                       [Reminder]       ││
│  │  21:00  ○ Daily backup check                   [Task]           ││
│  │                                                                 ││
│  │  ─── Tomorrow, Feb 23 ───────────────────────                   ││
│  │  09:00  ○ Generate weekly report               [Task]           ││
│  │                                                                 ││
│  │                    [Load more ↓]                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐             │
│  │ 📋 Notebook   │ │ 📡 Channels   │ │ 💬 Quick Chat │             │
│  │ 3 items       │ │ 1 connected   │ │ Last: 2h ago  │             │
│  └───────────────┘ └───────────────┘ └───────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

### Space Allocation

| Section | Current | Target |
|---------|---------|--------|
| Timeline | ~25% | **60-70%** |
| Notebook | ~20% | Collapsed card |
| Channels | ~15% | Collapsed card |
| Chats | ~20% | Collapsed card |
| Active Now | ~20% | Integrated into Timeline |

### Key Features

#### 1. Bidirectional Infinite Scroll
- Scroll **up** to load older items (paginated)
- Scroll **down** to load future items
- "Now" marker stays visually prominent
- Auto-scroll to "Now" on page load
- Keyboard: `n` jumps to now

#### 2. Visual State Differentiation

| State | Icon | Color | Style |
|-------|------|-------|-------|
| Completed | ✓ | Green | Muted opacity (0.6), optional strikethrough |
| Running | ● (pulse) | Red (#f7768e) | Full opacity, progress bar below |
| Pending | ○ | Blue (#7aa2f7) | Full opacity |
| Failed | ✗ | Red | Full opacity, expandable error |
| Skipped | ⊘ | Gray | Italic text |

#### 3. Expandable Items
Click chevron to expand inline details:

```
13:49  ✓ Send urgent WhatsApp to Hanan        [Task] [▼]
       └─────────────────────────────────────────────────┐
         Duration: 1 min 23 sec                          │
         Channel: WhatsApp (ninas_whatsapp)              │
         Delivered to: +1-555-XXX-XXXX                   │
         [View conversation] [View task details]         │
       └─────────────────────────────────────────────────┘
```

#### 4. Filtering & Search
- **Quick filters:** All | Tasks | Events | Reminders
- **Status filters:** Completed | Running | Pending | Failed
- **Search:** Title, content, channel
- **Date range:** Today | This week | Custom

#### 5. "Now" Anchor
- Visual: Prominent red horizontal line with timestamp
- Double-click: Scroll to now
- Auto-update: Timestamp refreshes every minute
- Keyboard: `n` key jumps to now

## Data Model

### TimelineItem Interface

```typescript
interface TimelineItem {
  id: string;
  type: 'task' | 'event' | 'reminder';
  title: string;
  time: Date;  // Primary sort key

  // Status
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  completedAt?: Date;
  startedAt?: Date;
  duration?: number;  // milliseconds

  // For expansion
  summary?: string;           // Brief completion summary
  deliverables?: string[];    // What was produced
  channel?: string;           // Which channel was used
  error?: string;             // If failed

  // Visual state
  isPast: boolean;
  showDateSeparator: boolean;
  showNowMarker: boolean;

  // Links
  taskId?: string;
  eventId?: string;
  conversationId?: string;
}
```

### Pagination Response

```typescript
interface TimelineResponse {
  items: TimelineItem[];
  hasMore: boolean;
  oldestTimestamp?: string;  // For "load more past"
  newestTimestamp?: string;  // For "load more future"
}
```

## API Design

### New Endpoint: GET /api/timeline

```
GET /api/timeline?before=<ISO>&after=<ISO>&limit=20&types=task,event&status=completed,pending
```

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| before | ISO timestamp | now + 7 days | Load items before this time |
| after | ISO timestamp | now - 24h | Load items after this time |
| limit | number | 20 | Max items to return |
| types | comma-separated | all | Filter by type |
| status | comma-separated | all | Filter by status |
| search | string | none | Search title/content |

**Response:**
```json
{
  "items": [...],
  "hasMorePast": true,
  "hasMoreFuture": false,
  "oldestTimestamp": "2026-02-21T00:00:00Z",
  "newestTimestamp": "2026-02-28T00:00:00Z"
}
```

### Implementation Location

Create new file: `packages/dashboard/src/routes/timeline.ts`

```typescript
import type { FastifyInstance } from "fastify";

export async function registerTimelineRoutes(fastify: FastifyInstance) {
  fastify.get("/api/timeline", async (request, reply) => {
    const { before, after, limit = 20, types, status, search } = request.query;

    // Merge data from:
    // 1. fastify.taskManager.list() - all tasks
    // 2. CalDAV client - calendar events
    // 3. Future: reminders from memory system

    // Apply filters, sort by time, paginate
    // Return TimelineResponse
  });
}
```

## Frontend Implementation

### Files to Modify

#### 1. `packages/dashboard/public/index.html`

**Homepage restructure:**
```html
<!-- Dashboard Tab -->
<div x-show="activeTab === 'home'" class="h-full flex flex-col p-4 gap-4">

  <!-- Timeline (hero section - 70% height) -->
  <div class="flex-1 min-h-0 flex flex-col glass rounded-2xl overflow-hidden">
    <!-- Timeline header with search/filters -->
    <div class="p-4 border-b border-tokyo-panel flex items-center justify-between">
      <h2 class="text-lg font-semibold">Timeline</h2>
      <div class="flex items-center gap-2">
        <!-- Filter buttons -->
        <button class="px-3 py-1 text-xs rounded-full"
                :class="timelineFilter === 'all' ? 'bg-tokyo-blue text-white' : 'glass-strong'">
          All
        </button>
        <!-- ... more filters ... -->
        <!-- Search -->
        <input type="text" placeholder="Search..." class="glass-strong rounded-lg px-3 py-1 text-sm w-40">
      </div>
    </div>

    <!-- Scrollable timeline content -->
    <div class="flex-1 overflow-y-auto p-4"
         x-ref="timelineScroll"
         @scroll="handleTimelineScroll">
      <!-- Items rendered here -->
    </div>
  </div>

  <!-- Compact cards row (30% height) -->
  <div class="flex gap-4">
    <div class="flex-1 glass rounded-xl p-3">
      <h3 class="text-xs font-semibold text-tokyo-muted uppercase">Notebook</h3>
      <!-- Compact notebook preview -->
    </div>
    <div class="flex-1 glass rounded-xl p-3">
      <h3 class="text-xs font-semibold text-tokyo-muted uppercase">Channels</h3>
      <!-- Compact channels list -->
    </div>
    <div class="flex-1 glass rounded-xl p-3">
      <h3 class="text-xs font-semibold text-tokyo-muted uppercase">Recent Chat</h3>
      <!-- Last conversation preview -->
    </div>
  </div>
</div>
```

#### 2. `packages/dashboard/public/js/app.js`

**New state and methods:**
```javascript
// State
timeline: [],
timelineLoading: false,
timelineFilter: 'all',      // all | tasks | events
timelineStatusFilter: null, // null = all, or 'completed' | 'pending' | 'failed'
timelineSearch: '',
timelineHasMorePast: true,
timelineHasMoreFuture: true,
timelineOldest: null,
timelineNewest: null,

// Methods
async loadTimeline(direction = 'initial') {
  this.timelineLoading = true;

  const params = new URLSearchParams();
  params.set('limit', '20');

  if (direction === 'past' && this.timelineOldest) {
    params.set('before', this.timelineOldest);
  } else if (direction === 'future' && this.timelineNewest) {
    params.set('after', this.timelineNewest);
  }

  if (this.timelineFilter !== 'all') {
    params.set('types', this.timelineFilter);
  }
  if (this.timelineStatusFilter) {
    params.set('status', this.timelineStatusFilter);
  }
  if (this.timelineSearch) {
    params.set('search', this.timelineSearch);
  }

  const res = await fetch(`/api/timeline?${params}`);
  const data = await res.json();

  if (direction === 'past') {
    this.timeline = [...data.items, ...this.timeline];
  } else if (direction === 'future') {
    this.timeline = [...this.timeline, ...data.items];
  } else {
    this.timeline = data.items;
  }

  this.timelineHasMorePast = data.hasMorePast;
  this.timelineHasMoreFuture = data.hasMoreFuture;
  this.timelineOldest = data.oldestTimestamp;
  this.timelineNewest = data.newestTimestamp;
  this.timelineLoading = false;
},

handleTimelineScroll(e) {
  const el = e.target;

  // Load more past when scrolled near top
  if (el.scrollTop < 100 && this.timelineHasMorePast && !this.timelineLoading) {
    this.loadTimeline('past');
  }

  // Load more future when scrolled near bottom
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100
      && this.timelineHasMoreFuture && !this.timelineLoading) {
    this.loadTimeline('future');
  }
},

scrollToNow() {
  const nowMarker = this.$refs.timelineScroll?.querySelector('[data-now-marker]');
  nowMarker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
},

toggleTimelineExpand(itemId) {
  // Toggle expansion state for item
},
```

#### 3. `packages/dashboard/public/css/` (if exists) or inline styles

**Timeline-specific styles:**
```css
/* Now marker */
.timeline-now-marker {
  background: linear-gradient(90deg, transparent, #f7768e, transparent);
  height: 2px;
  position: relative;
}

.timeline-now-marker::before {
  content: attr(data-time);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  background: #f7768e;
  color: white;
  padding: 2px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Timeline item states */
.timeline-item-completed {
  opacity: 0.6;
}

.timeline-item-running {
  border-left: 3px solid #f7768e;
  animation: pulse-border 2s infinite;
}

.timeline-item-failed {
  border-left: 3px solid #f7768e;
  background: rgba(247, 118, 142, 0.1);
}

/* Expansion */
.timeline-item-expanded {
  background: rgba(122, 162, 247, 0.1);
}

.timeline-item-details {
  margin-left: 4rem;
  padding: 12px;
  border-left: 2px solid #565f89;
  font-size: 12px;
}
```

## Implementation Phases

### Phase 1: Past Items Visible ✅ (Quick fix done)
- [x] Modify `timelineItems` to include completed tasks from last 24h
- [x] Add visual states (checkmark, muted, "Done" badge)
- [x] Inline "Now" marker between past/future

### Phase 2: API & Pagination
- [ ] Create `/api/timeline` endpoint
- [ ] Merge tasks + calendar events server-side
- [ ] Add pagination support (before/after cursors)
- [ ] Add filtering support (types, status, search)

### Phase 3: Hero Placement
- [ ] Redesign homepage layout (Timeline = 70%)
- [ ] Compact Notebook, Channels, Chats into cards
- [ ] Implement scroll container with proper height
- [ ] Add "Jump to Now" button and keyboard shortcut

### Phase 4: Infinite Scroll
- [ ] Implement scroll-based pagination
- [ ] Add loading spinners for load-more
- [ ] Preserve scroll position on data load
- [ ] Add pull-to-refresh for mobile

### Phase 5: Rich Features
- [ ] Inline item expansion
- [ ] Filter UI (tabs or dropdown)
- [ ] Search input with debounce
- [ ] Keyboard navigation (j/k, n for now)

## Sprint Estimate

| Phase | Effort | Notes |
|-------|--------|-------|
| Phase 2 (API) | 3-4 hours | New route, data merging |
| Phase 3 (Layout) | 4-5 hours | Homepage restructure |
| Phase 4 (Scroll) | 3-4 hours | Pagination UX |
| Phase 5 (Features) | 4-6 hours | Polish & extras |
| **Total** | **~2 days** | Can be split across sprints |

## Open Questions (Decisions Needed)

1. **Default time range:** Show last 24h + next 7 days, or last 7 days + next 7 days?
   - Recommendation: 24h past, 7 days future (quick initial load)

2. **Recurring tasks:** Show each occurrence, or group with "×N" badge?
   - Recommendation: Show each, but add "recurring" indicator

3. **Failed tasks:** Auto-expand to show error, or collapsed by default?
   - Recommendation: Collapsed, but with red border to draw attention

4. **Mobile behavior:** Swipe gestures for time navigation?
   - Recommendation: Defer to Phase 5+, standard scroll for now

## Relation to Calendar Tab

| Aspect | Timeline | Calendar |
|--------|----------|----------|
| View | Linear, scrollable | Grid (week/month) |
| Focus | Activity flow | Time blocking |
| Past | Full history | Limited (scroll back) |
| Primary use | Status check, history | Planning, scheduling |

They complement each other — **Calendar for planning, Timeline for living.**

## Testing Checklist

- [ ] Timeline loads with past + future items
- [ ] "Now" marker shows between past/future
- [ ] Completed tasks show ✓ and muted style
- [ ] Running tasks show pulse animation
- [ ] Failed tasks show ✗ and red styling
- [ ] Scroll up loads more past items
- [ ] Scroll down loads more future items
- [ ] Filters work (type, status)
- [ ] Search filters by title
- [ ] Clicking item opens task/event view
- [ ] Expand button shows inline details
- [ ] "Jump to Now" works
- [ ] Keyboard `n` jumps to now
- [ ] Mobile: timeline scrolls smoothly
- [ ] Performance: 100+ items renders fast
