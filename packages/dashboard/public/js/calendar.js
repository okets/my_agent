/**
 * Calendar Module
 *
 * FullCalendar initialization and event handlers.
 * Integrates with the main Alpine.js app.
 */

/**
 * Map automation job status to calendar event color.
 */
const timelineStatusColors = {
  completed: "#22c55e", // green
  failed: "#ef4444", // red
  needs_review: "#f59e0b", // amber
  running: "#3b82f6", // blue
  scheduled: "#22d3ee", // cyan
};

/**
 * Fetch timeline events (past jobs + future runs) for FullCalendar.
 * Used as a custom event source function.
 */
async function fetchTimelineEvents(
  fetchInfo,
  successCallback,
  failureCallback,
) {
  try {
    const params = new URLSearchParams({
      after: fetchInfo.start.toISOString(),
      before: fetchInfo.end.toISOString(),
      limit: "200",
    });
    const res = await fetch(`/api/timeline?${params}`);
    if (!res.ok) {
      failureCallback(new Error(`Timeline API returned ${res.status}`));
      return;
    }
    const data = await res.json();
    const events = [];

    // Past jobs
    for (const job of data.pastJobs || []) {
      events.push({
        id: job.id,
        title: job.automationName || "Automation",
        start: job.created,
        end: job.completed || undefined,
        color: timelineStatusColors[job.status] || "#6b7280",
        extendedProps: {
          type: "automation",
          jobId: job.id,
          automationId: job.automationId,
          status: job.status,
        },
      });
    }

    // Future projected runs
    for (const run of data.futureRuns || []) {
      events.push({
        id: run.id,
        title: run.automationName + " (scheduled)",
        start: run.scheduledFor,
        color: timelineStatusColors.scheduled,
        extendedProps: {
          type: "automation",
          automationId: run.automationId,
          status: "scheduled",
          projected: true,
        },
      });
    }

    successCallback(events);
  } catch (err) {
    failureCallback(err);
  }
}

/**
 * Initialize FullCalendar on a DOM element
 * @param {HTMLElement} el - Container element
 * @param {Object} options - Configuration options
 * @returns {Object} FullCalendar instance
 */
function initCalendar(el, options = {}) {
  const {
    onEventClick,
    onDateSelect,
    onEventDrop,
    onEventResize,
    onDatesSet,
    visibleCalendars = [],
  } = options;

  const calendar = new FullCalendar.Calendar(el, {
    // Views
    initialView: "listWeek",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
    },

    // Behavior
    editable: true,
    selectable: true,
    selectMirror: true,
    dayMaxEvents: true,
    nowIndicator: true,
    weekNumbers: false,

    // Time settings
    slotMinTime: "06:00:00",
    slotMaxTime: "22:00:00",
    scrollTime: "08:00:00",
    slotDuration: "00:30:00",

    // Styling
    height: "100%",
    themeSystem: "standard",
    slotEventOverlap: false,

    // Per-view settings
    displayEventTime: false,
    views: {
      dayGridMonth: {
        eventContent: (arg) => {
          const title = (arg.event.title || "").replace(" (scheduled)", "");
          return { html: `<span class="fc-event-title">${title}</span>` };
        },
      },
      timeGridWeek: {
        eventContent: (arg) => {
          const title = (arg.event.title || "").replace(" (scheduled)", "");
          return { html: `<span class="fc-event-title">${title}</span>` };
        },
      },
      listWeek: {
        displayEventTime: true,
      },
    },

    // Event sources: CalDAV + Timeline (automations)
    eventSources: [
      {
        url: "/api/calendar/events",
        method: "GET",
        extraParams: () => {
          if (visibleCalendars.length > 0) {
            return { calendars: visibleCalendars.join(",") };
          }
          return {};
        },
        failure: (err) => {
          console.error("[Calendar] Failed to fetch events:", err);
        },
      },
      {
        events: fetchTimelineEvents,
        failure: (err) => {
          console.error("[Calendar] Failed to fetch timeline events:", err);
        },
      },
    ],

    // Event handlers
    eventClick: (info) => {
      if (onEventClick) {
        onEventClick(info.event, info.el);
      }
    },

    select: (info) => {
      if (onDateSelect) {
        onDateSelect({
          start: info.start,
          end: info.end,
          allDay: info.allDay,
        });
      }
      calendar.unselect();
    },

    eventDrop: async (info) => {
      if (onEventDrop) {
        const success = await onEventDrop(info.event);
        if (!success) {
          info.revert();
        }
      }
    },

    eventResize: async (info) => {
      if (onEventResize) {
        const success = await onEventResize(info.event);
        if (!success) {
          info.revert();
        }
      }
    },

    // View change handler (for context tracking)
    datesSet: (dateInfo) => {
      if (onDatesSet) {
        onDatesSet(dateInfo);
      }
    },

    // Loading indicator
    loading: (isLoading) => {
      // Could show a spinner here
    },
  });

  calendar.render();
  return calendar;
}

/**
 * Initialize mini calendar for Home tab
 * @param {HTMLElement} el - Container element
 * @param {Function} onDateClick - Called when user clicks a date
 * @returns {Object} FullCalendar instance
 */
function initMiniCalendar(el, onDateClick) {
  const calendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    headerToolbar: {
      left: "prev",
      center: "title",
      right: "next",
    },

    // Compact settings
    height: "auto",
    fixedWeekCount: false,
    showNonCurrentDates: true,
    dayMaxEvents: 0, // Don't show event dots

    // Event source (just to highlight days with events)
    events: {
      url: "/api/calendar/events",
      method: "GET",
      success: (events) => {
        // We don't render events, just use them to highlight days
        return events;
      },
    },

    // Click handler
    dateClick: (info) => {
      if (onDateClick) {
        onDateClick(info.date);
      }
    },

    // Highlight days with events
    dayCellDidMount: (info) => {
      // This runs after events are loaded
      // We could add a dot indicator here
    },
  });

  calendar.render();
  return calendar;
}

/**
 * Format event time for display
 * @param {Object} event - FullCalendar event object
 * @returns {string} Formatted time string
 */
function formatEventTime(event) {
  if (event.allDay) {
    return "All day";
  }
  const start = event.start;
  if (!start) return "";
  const hours = start.getHours().toString().padStart(2, "0");
  const minutes = start.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Create event via API
 * @param {Object} eventData - Event data
 * @returns {Object|null} Created event or null on error
 */
async function createCalendarEvent(eventData) {
  try {
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error("[Calendar] Create failed:", err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[Calendar] Create error:", err);
    return null;
  }
}

/**
 * Update event via API
 * @param {string} uid - Event UID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated event or null on error
 */
async function updateCalendarEvent(uid, updates) {
  try {
    const res = await fetch(`/api/calendar/events/${encodeURIComponent(uid)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error("[Calendar] Update failed:", err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[Calendar] Update error:", err);
    return null;
  }
}

/**
 * Delete event via API
 * @param {string} uid - Event UID
 * @param {string} calendarId - Calendar ID (optional)
 * @returns {boolean} Success
 */
async function deleteCalendarEvent(uid, calendarId) {
  try {
    let url = `/api/calendar/events/${encodeURIComponent(uid)}`;
    if (calendarId) {
      url += `?calendarId=${encodeURIComponent(calendarId)}`;
    }
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      console.error("[Calendar] Delete failed");
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Calendar] Delete error:", err);
    return false;
  }
}

/**
 * Fetch calendar configuration
 * @returns {Object} Calendar config with list of calendars
 */
async function fetchCalendarConfig() {
  try {
    const res = await fetch("/api/calendar/config");
    if (!res.ok) {
      return { calendars: [] };
    }
    return await res.json();
  } catch (err) {
    console.error("[Calendar] Config fetch error:", err);
    return { calendars: [] };
  }
}

/**
 * Fetch today's events
 * @returns {Array} Array of events for today
 */
async function fetchTodayEvents() {
  try {
    const res = await fetch("/api/calendar/events/today");
    if (!res.ok) {
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error("[Calendar] Today events fetch error:", err);
    return [];
  }
}

/**
 * Fetch upcoming events
 * @param {number} days - Number of days ahead to fetch (default 7)
 * @returns {Array} Array of upcoming events
 */
async function fetchUpcomingEvents(days = 7) {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      start: now.toISOString(),
      end: end.toISOString(),
    });
    const res = await fetch(`/api/calendar/events?${params}`);
    if (!res.ok) {
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error("[Calendar] Upcoming events fetch error:", err);
    return [];
  }
}

// Export for use in app.js
window.CalendarModule = {
  initCalendar,
  initMiniCalendar,
  formatEventTime,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarConfig,
  fetchTodayEvents,
  fetchUpcomingEvents,
};
