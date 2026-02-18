// Calendar App - FullCalendar Integration

// Calendar colors mapping
const CALENDAR_COLORS = {
  work: {
    background: '#89b4fa', // Catppuccin blue
    text: '#11111b'        // Catppuccin crust
  },
  personal: {
    background: '#cba6f7', // Catppuccin mauve
    text: '#11111b'        // Catppuccin crust
  }
};

// State
let calendar;
let events = [];
let visibleCalendars = new Set(['work', 'personal']);

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initCalendar();
  initSidebarToggles();
  initPopover();
  initModal();
  loadEvents();
});

// Initialize FullCalendar
function initCalendar() {
  const calendarEl = document.getElementById('calendar');

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'timeGridWeek',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'timeGridWeek,dayGridMonth,timeGridDay,listWeek newEvent'
    },
    customButtons: {
      newEvent: {
        text: '+ New Event',
        click: () => openNewEventModal()
      }
    },
    buttonText: {
      today: 'Today',
      week: 'Week',
      month: 'Month',
      day: 'Day',
      list: 'List'
    },
    nowIndicator: true,
    allDaySlot: true,
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    slotDuration: '00:30:00',
    slotLabelInterval: '01:00:00',
    expandRows: true,
    height: 'auto',
    eventClick: (info) => showEventPopover(info),
    eventDidMount: (info) => {
      // Add calendar type as data attribute for filtering
      info.el.dataset.calendarType = info.event.extendedProps.calendarType;
    },
    events: (fetchInfo, successCallback, failureCallback) => {
      // Filter events based on visible calendars
      const filtered = events.filter(e => visibleCalendars.has(e.calendarType));
      successCallback(filtered);
    }
  });

  calendar.render();
}

// Load events from JSON file
async function loadEvents() {
  try {
    const response = await fetch('events.json');
    if (!response.ok) {
      console.warn('events.json not found, using sample events');
      events = getSampleEvents();
    } else {
      const data = await response.json();
      events = transformEvents(data);
    }
    calendar.refetchEvents();
  } catch (error) {
    console.warn('Error loading events, using sample events:', error);
    events = getSampleEvents();
    calendar.refetchEvents();
  }
}

// Transform events from JSON to FullCalendar format
function transformEvents(data) {
  return data.map(event => ({
    id: event.id || crypto.randomUUID(),
    title: event.title || event.summary,
    start: event.start || event.dtstart,
    end: event.end || event.dtend,
    allDay: event.allDay || false,
    backgroundColor: CALENDAR_COLORS[event.calendar]?.background || CALENDAR_COLORS.work.background,
    textColor: CALENDAR_COLORS[event.calendar]?.text || CALENDAR_COLORS.work.text,
    calendarType: event.calendar || 'work',
    extendedProps: {
      calendarType: event.calendar || 'work',
      description: event.description || ''
    }
  }));
}

// Sample events for demo
function getSampleEvents() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);

  const formatDate = (date, hours, minutes = 0) => {
    const d = new Date(date);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };

  return [
    {
      id: '1',
      title: 'Team Standup',
      start: formatDate(monday, 10, 0),
      end: formatDate(monday, 10, 30),
      backgroundColor: CALENDAR_COLORS.work.background,
      textColor: CALENDAR_COLORS.work.text,
      calendarType: 'work',
      extendedProps: { calendarType: 'work' }
    },
    {
      id: '2',
      title: 'Sprint Planning',
      start: formatDate(monday, 14, 0),
      end: formatDate(monday, 15, 30),
      backgroundColor: CALENDAR_COLORS.work.background,
      textColor: CALENDAR_COLORS.work.text,
      calendarType: 'work',
      extendedProps: { calendarType: 'work' }
    },
    {
      id: '3',
      title: 'Dentist Appointment',
      start: formatDate(new Date(monday.getTime() + 86400000), 15, 0),
      end: formatDate(new Date(monday.getTime() + 86400000), 16, 0),
      backgroundColor: CALENDAR_COLORS.personal.background,
      textColor: CALENDAR_COLORS.personal.text,
      calendarType: 'personal',
      extendedProps: { calendarType: 'personal' }
    },
    {
      id: '4',
      title: 'Code Review',
      start: formatDate(new Date(monday.getTime() + 172800000), 11, 0),
      end: formatDate(new Date(monday.getTime() + 172800000), 12, 0),
      backgroundColor: CALENDAR_COLORS.work.background,
      textColor: CALENDAR_COLORS.work.text,
      calendarType: 'work',
      extendedProps: { calendarType: 'work' }
    },
    {
      id: '5',
      title: 'Gym Session',
      start: formatDate(new Date(monday.getTime() + 172800000), 18, 0),
      end: formatDate(new Date(monday.getTime() + 172800000), 19, 30),
      backgroundColor: CALENDAR_COLORS.personal.background,
      textColor: CALENDAR_COLORS.personal.text,
      calendarType: 'personal',
      extendedProps: { calendarType: 'personal' }
    },
    {
      id: '6',
      title: '1:1 with Manager',
      start: formatDate(new Date(monday.getTime() + 259200000), 10, 0),
      end: formatDate(new Date(monday.getTime() + 259200000), 10, 30),
      backgroundColor: CALENDAR_COLORS.work.background,
      textColor: CALENDAR_COLORS.work.text,
      calendarType: 'work',
      extendedProps: { calendarType: 'work' }
    },
    {
      id: '7',
      title: 'Friday Team Lunch',
      start: formatDate(new Date(monday.getTime() + 345600000), 12, 0),
      end: formatDate(new Date(monday.getTime() + 345600000), 13, 30),
      backgroundColor: CALENDAR_COLORS.work.background,
      textColor: CALENDAR_COLORS.work.text,
      calendarType: 'work',
      extendedProps: { calendarType: 'work' }
    }
  ];
}

// Sidebar calendar toggles
function initSidebarToggles() {
  const checkboxes = document.querySelectorAll('.calendar-toggle input[type="checkbox"]');

  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const calendarType = e.target.dataset.calendar;

      if (e.target.checked) {
        visibleCalendars.add(calendarType);
      } else {
        visibleCalendars.delete(calendarType);
      }

      calendar.refetchEvents();
    });
  });
}

// Event Popover
function initPopover() {
  const popover = document.getElementById('event-popover');
  const closeBtn = popover.querySelector('.popover-close');

  closeBtn.addEventListener('click', () => hidePopover());

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && !e.target.closest('.fc-event')) {
      hidePopover();
    }
  });

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePopover();
    }
  });
}

function showEventPopover(info) {
  const popover = document.getElementById('event-popover');
  const event = info.event;
  const rect = info.el.getBoundingClientRect();

  // Populate popover
  document.getElementById('popover-title').textContent = event.title;

  const startTime = event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = event.end ? event.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const dateStr = event.start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  document.getElementById('popover-time').textContent = endTime
    ? `${dateStr}, ${startTime} - ${endTime}`
    : `${dateStr}, ${startTime}`;

  // Build calendar indicator using DOM methods (avoid innerHTML for security)
  const calendarType = event.extendedProps.calendarType;
  const calendarName = calendarType.charAt(0).toUpperCase() + calendarType.slice(1);
  const popoverCalendarEl = document.getElementById('popover-calendar');
  popoverCalendarEl.textContent = ''; // Clear existing content

  const dot = document.createElement('span');
  dot.style.display = 'inline-block';
  dot.style.width = '10px';
  dot.style.height = '10px';
  dot.style.borderRadius = '50%';
  dot.style.background = CALENDAR_COLORS[calendarType].background;
  dot.style.marginRight = '6px';

  popoverCalendarEl.appendChild(dot);
  popoverCalendarEl.appendChild(document.createTextNode(calendarName));

  // Position popover
  const popoverWidth = 250;
  let left = rect.right + 10;
  let top = rect.top;

  // Adjust if too close to right edge
  if (left + popoverWidth > window.innerWidth - 20) {
    left = rect.left - popoverWidth - 10;
  }

  // Adjust if too close to bottom
  if (top + 150 > window.innerHeight) {
    top = window.innerHeight - 170;
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.display = 'block';
}

function hidePopover() {
  document.getElementById('event-popover').style.display = 'none';
}

// New Event Modal
function initModal() {
  const modal = document.getElementById('event-modal');
  const closeBtn = modal.querySelector('.modal-close');
  const cancelBtn = modal.querySelector('.modal-cancel');
  const form = document.getElementById('event-form');

  closeBtn.addEventListener('click', () => closeModal());
  cancelBtn.addEventListener('click', () => closeModal());

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      closeModal();
    }
  });

  // Handle form submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    createEvent();
  });
}

function openNewEventModal(startDate) {
  const modal = document.getElementById('event-modal');
  const form = document.getElementById('event-form');

  // Reset form
  form.reset();

  // Set default times
  const now = startDate || new Date();
  const start = new Date(now);
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  document.getElementById('event-start').value = formatDateTimeLocal(start);
  document.getElementById('event-end').value = formatDateTimeLocal(end);

  modal.style.display = 'flex';
  document.getElementById('event-title').focus();
}

function closeModal() {
  document.getElementById('event-modal').style.display = 'none';
}

function createEvent() {
  const title = document.getElementById('event-title').value;
  const calendarType = document.getElementById('event-calendar').value;
  const start = document.getElementById('event-start').value;
  const end = document.getElementById('event-end').value;

  const newEvent = {
    id: crypto.randomUUID(),
    title,
    start,
    end,
    backgroundColor: CALENDAR_COLORS[calendarType].background,
    textColor: CALENDAR_COLORS[calendarType].text,
    calendarType,
    extendedProps: { calendarType }
  };

  events.push(newEvent);
  calendar.refetchEvents();
  closeModal();
}

// Utility: Format date for datetime-local input
function formatDateTimeLocal(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
