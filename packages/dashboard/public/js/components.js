/**
 * Shared UI Components
 *
 * Reusable component functions for Task and Event detail tabs.
 * These return HTML strings for use with x-html in Alpine.js templates.
 */

/**
 * Status badge color mappings
 */
const STATUS_COLORS = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  running: "bg-tokyo-blue/20 text-tokyo-blue border-tokyo-blue/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  paused: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  deleted: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

/**
 * Status badge labels (human-readable)
 */
const STATUS_LABELS = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  paused: "Paused",
  deleted: "Deleted",
};

/**
 * Task type badge colors
 */
const TYPE_COLORS = {
  immediate: "bg-tokyo-purple/20 text-tokyo-purple border-tokyo-purple/30",
  scheduled: "bg-tokyo-cyan/20 text-tokyo-cyan border-tokyo-cyan/30",
};

/**
 * Task type labels
 */
const TYPE_LABELS = {
  immediate: "Immediate",
  scheduled: "Scheduled",
};

/**
 * Source type labels
 */
const SOURCE_LABELS = {
  calendar: "Calendar",
  manual: "Manual",
  brain: "Brain",
  user: "User",
};

/**
 * Render a status badge
 *
 * @param {string} status - Status key (pending, running, completed, failed, paused, deleted)
 * @returns {string} HTML string for the badge
 */
function renderStatusBadge(status) {
  const colorClass = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const label = STATUS_LABELS[status] || status;

  return `<span class="px-2 py-0.5 text-xs font-medium rounded-full border ${colorClass}">${label}</span>`;
}

/**
 * Render a type badge (immediate/scheduled)
 *
 * @param {string} type - Type key (immediate, scheduled)
 * @returns {string} HTML string for the badge
 */
function renderTypeBadge(type) {
  const colorClass = TYPE_COLORS[type] || TYPE_COLORS.immediate;
  const label = TYPE_LABELS[type] || type;

  return `<span class="px-2 py-0.5 text-xs font-medium rounded-full border ${colorClass}">${label}</span>`;
}

/**
 * Render a source type badge
 *
 * @param {string} sourceType - Source type (calendar, manual, brain, user)
 * @returns {string} HTML string for the badge
 */
function renderSourceBadge(sourceType) {
  const label = SOURCE_LABELS[sourceType] || sourceType;

  return `<span class="px-2 py-0.5 text-xs font-medium rounded-full border bg-white/5 text-tokyo-muted border-white/10">${label}</span>`;
}

/**
 * Format a date for display
 *
 * @param {Date|string} date - Date to format
 * @param {Object} options - Formatting options
 * @param {boolean} options.includeTime - Include time in output
 * @param {boolean} options.relative - Use relative time (e.g., "2 hours ago")
 * @returns {string} Formatted date string
 */
function formatDate(date, options = {}) {
  if (!date) return "—";

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";

  const { includeTime = true, relative = false } = options;

  if (relative) {
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
  }

  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });

  if (!includeTime) return dateStr;

  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dateStr} at ${timeStr}`;
}

/**
 * Render a metadata row with icon, label, and value
 *
 * @param {Object} options
 * @param {string} options.icon - SVG icon HTML or emoji
 * @param {string} options.label - Label text
 * @param {string} options.value - Value text
 * @param {string} options.valueClass - Optional extra classes for value
 * @returns {string} HTML string
 */
function renderMetadataRow({ icon, label, value, valueClass = "" }) {
  const iconHtml = icon.startsWith("<")
    ? `<span class="w-4 h-4 text-tokyo-muted shrink-0">${icon}</span>`
    : `<span class="w-4 h-4 text-center shrink-0">${icon}</span>`;

  return `
    <div class="flex items-center gap-3 py-2">
      ${iconHtml}
      <span class="text-tokyo-muted text-sm w-24 shrink-0">${label}</span>
      <span class="text-tokyo-text text-sm ${valueClass}">${value || "—"}</span>
    </div>
  `;
}

/**
 * Common SVG icons for metadata rows
 */
const ICONS = {
  calendar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"/>
  </svg>`,

  clock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm.75-10.25a.75.75 0 0 0-1.5 0v3.5c0 .414.336.75.75.75h3a.75.75 0 0 0 0-1.5H8.75v-2.75Z" clip-rule="evenodd"/>
  </svg>`,

  user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM4.5 11.5a3.5 3.5 0 0 1 7 0v.5h-7v-.5Z" clip-rule="evenodd"/>
  </svg>`,

  play: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z"/>
  </svg>`,

  check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/>
  </svg>`,

  link: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.95-2.475.75.75 0 0 1 1.5 0 2 2 0 0 0 3.4 1.425l2-2a2 2 0 0 0 0-2.83.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/>
    <path fill-rule="evenodd" d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.95 2.475.75.75 0 0 1-1.5 0 2 2 0 0 0-3.4-1.425l-2 2a2 2 0 0 0 0 2.83.75.75 0 0 1 0 1.06Z" clip-rule="evenodd"/>
  </svg>`,

  document: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L9.94 2.439A1.5 1.5 0 0 0 8.878 2H4Zm1 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5H5Zm0 3a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H5Zm0 3a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H5Z" clip-rule="evenodd"/>
  </svg>`,

  chat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M1 8.74c0 .983.713 1.825 1.69 1.943.764.092 1.534.164 2.31.216v2.351a.75.75 0 0 0 1.28.53l2.51-2.51c.182-.181.427-.283.683-.283h.06a24.22 24.22 0 0 0 4.777-.477C15.287 10.353 16 9.512 16 8.74V4.26c0-.983-.713-1.825-1.69-1.943A25.35 25.35 0 0 0 8 2c-2.18 0-4.306.162-6.31.317C.713 2.435 0 3.277 0 4.26v4.48Z" clip-rule="evenodd"/>
  </svg>`,

  source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
    <path fill-rule="evenodd" d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.751 2.751 0 0 1-.892.596l-2.047.848a.75.75 0 0 1-.98-.98l.848-2.047a2.75 2.75 0 0 1 .596-.892l7.262-7.261Z" clip-rule="evenodd"/>
  </svg>`,
};

/**
 * Get status color class for list items (dot indicator)
 *
 * @param {string} status - Task status
 * @returns {string} Tailwind color class
 */
function getStatusDotClass(status) {
  const dotColors = {
    pending: "bg-yellow-400",
    running: "bg-tokyo-blue",
    completed: "bg-green-400",
    failed: "bg-red-400",
    paused: "bg-orange-400",
    deleted: "bg-gray-400",
  };
  return dotColors[status] || dotColors.pending;
}

// Export for use in Alpine.js
window.UIComponents = {
  STATUS_COLORS,
  STATUS_LABELS,
  TYPE_COLORS,
  TYPE_LABELS,
  SOURCE_LABELS,
  ICONS,
  renderStatusBadge,
  renderTypeBadge,
  renderSourceBadge,
  formatDate,
  renderMetadataRow,
  getStatusDotClass,
};
