/**
 * CalDAV Calendar Prototype
 *
 * Tests connection to Radicale, creates events (one-time and recurring),
 * expands recurring events, and outputs all events to events.json.
 */

import { createDAVClient, DAVCalendar, DAVObject } from "tsdav";
import IcalExpander from "ical-expander";
import { DateTime } from "luxon";
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";

const RADICALE_URL = "http://127.0.0.1:5232";
const USERNAME = "agent";
const PASSWORD = "agent123";
const CALENDAR_NAME = "test-calendar";

interface ExpandedEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  isRecurring: boolean;
  occurrenceIndex?: number;
}

/**
 * Generate an iCalendar VEVENT string
 */
function generateICalEvent(options: {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  rrule?: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//my_agent//calendar-prototype//EN",
    "BEGIN:VEVENT",
    `UID:${options.uid}`,
    `DTSTAMP:${DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
    `DTSTART:${options.dtstart}`,
    `DTEND:${options.dtend}`,
    `SUMMARY:${options.summary}`,
  ];

  if (options.rrule) {
    lines.push(`RRULE:${options.rrule}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}

/**
 * Create the calendar if it doesn't exist
 */
async function ensureCalendarExists(
  client: Awaited<ReturnType<typeof createDAVClient>>
): Promise<DAVCalendar> {
  console.log("Fetching calendars...");
  const calendars = await client.fetchCalendars();

  let calendar = calendars.find(
    (c) => c.displayName === CALENDAR_NAME || c.url.includes(CALENDAR_NAME)
  );

  if (!calendar) {
    console.log(`Creating calendar: ${CALENDAR_NAME}`);
    await client.makeCalendar({
      url: `${RADICALE_URL}/${USERNAME}/${CALENDAR_NAME}/`,
      props: {
        displayname: CALENDAR_NAME,
      },
    });

    // Refetch calendars to get the new one
    const updatedCalendars = await client.fetchCalendars();
    calendar = updatedCalendars.find(
      (c) => c.displayName === CALENDAR_NAME || c.url.includes(CALENDAR_NAME)
    );

    if (!calendar) {
      throw new Error("Failed to create calendar");
    }
  }

  console.log(`Using calendar: ${calendar.displayName || calendar.url}`);
  return calendar;
}

/**
 * Create the dentist appointment (one-time event, tomorrow at 3pm)
 */
async function createDentistAppointment(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  calendar: DAVCalendar
): Promise<void> {
  const uid = `dentist-${randomUUID()}@my_agent`;
  const tomorrow = DateTime.now().plus({ days: 1 }).set({
    hour: 15,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const endTime = tomorrow.plus({ hours: 1 });

  const dtstart = tomorrow.toFormat("yyyyMMdd'T'HHmmss");
  const dtend = endTime.toFormat("yyyyMMdd'T'HHmmss");

  const icalData = generateICalEvent({
    uid,
    summary: "Dentist appointment",
    dtstart,
    dtend,
  });

  console.log("Creating: Dentist appointment (tomorrow at 3pm)");

  await client.createCalendarObject({
    calendar,
    filename: `${uid}.ics`,
    iCalString: icalData,
  });
}

/**
 * Create weekly standup (recurring event, every Monday at 9am, 5 occurrences)
 */
async function createWeeklyStandup(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  calendar: DAVCalendar
): Promise<void> {
  const uid = `standup-${randomUUID()}@my_agent`;

  // Find next Monday
  let nextMonday = DateTime.now().set({
    hour: 9,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  while (nextMonday.weekday !== 1) {
    nextMonday = nextMonday.plus({ days: 1 });
  }

  const endTime = nextMonday.plus({ minutes: 30 });

  const dtstart = nextMonday.toFormat("yyyyMMdd'T'HHmmss");
  const dtend = endTime.toFormat("yyyyMMdd'T'HHmmss");

  const icalData = generateICalEvent({
    uid,
    summary: "Weekly standup",
    dtstart,
    dtend,
    rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=5",
  });

  console.log("Creating: Weekly standup (every Monday at 9am, 5 occurrences)");

  await client.createCalendarObject({
    calendar,
    filename: `${uid}.ics`,
    iCalString: icalData,
  });
}

/**
 * Fetch all events and expand recurring ones
 */
async function fetchAndExpandEvents(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  calendar: DAVCalendar
): Promise<ExpandedEvent[]> {
  console.log("\nFetching calendar objects...");

  const objects = await client.fetchCalendarObjects({
    calendar,
  });

  console.log(`Found ${objects.length} calendar object(s)`);

  const expandedEvents: ExpandedEvent[] = [];

  // 30-day window for expansion
  const windowStart = DateTime.now().startOf("day");
  const windowEnd = windowStart.plus({ days: 30 });

  for (const obj of objects) {
    if (!obj.data) continue;

    try {
      const expander = new IcalExpander({
        ics: obj.data,
        maxIterations: 100,
      });

      const expanded = expander.between(
        windowStart.toJSDate(),
        windowEnd.toJSDate()
      );

      // Process regular events
      for (const event of expanded.events) {
        const vevent = event.component;
        expandedEvents.push({
          uid: vevent.getFirstPropertyValue("uid") as string,
          summary: vevent.getFirstPropertyValue("summary") as string,
          start: event.startDate.toJSDate().toISOString(),
          end: event.endDate.toJSDate().toISOString(),
          isRecurring: false,
        });
      }

      // Process recurring event occurrences
      for (let i = 0; i < expanded.occurrences.length; i++) {
        const occurrence = expanded.occurrences[i];
        const vevent = occurrence.item.component;
        expandedEvents.push({
          uid: vevent.getFirstPropertyValue("uid") as string,
          summary: vevent.getFirstPropertyValue("summary") as string,
          start: occurrence.startDate.toJSDate().toISOString(),
          end: occurrence.endDate.toJSDate().toISOString(),
          isRecurring: true,
          occurrenceIndex: i + 1,
        });
      }
    } catch (err) {
      console.error(`Error parsing calendar object: ${err}`);
    }
  }

  // Sort by start time
  expandedEvents.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  return expandedEvents;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log("=== CalDAV Calendar Prototype ===\n");
  console.log(`Connecting to Radicale at ${RADICALE_URL}...`);

  try {
    // Create DAV client
    const client = await createDAVClient({
      serverUrl: RADICALE_URL,
      credentials: {
        username: USERNAME,
        password: PASSWORD,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    // Ensure calendar exists
    const calendar = await ensureCalendarExists(client);

    // Create events
    console.log("\n--- Creating Events ---");
    await createDentistAppointment(client, calendar);
    await createWeeklyStandup(client, calendar);

    // Fetch and expand events
    console.log("\n--- Fetching & Expanding Events ---");
    const events = await fetchAndExpandEvents(client, calendar);

    // Output to JSON
    const output = {
      fetchedAt: new Date().toISOString(),
      windowDays: 30,
      totalEvents: events.length,
      events,
    };

    const outputPath = new URL("../events.json", import.meta.url).pathname;
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${events.length} event(s) to events.json`);

    // Print summary
    console.log("\n--- Event Summary ---");
    for (const event of events) {
      const startDate = DateTime.fromISO(event.start);
      const formatted = startDate.toFormat("ccc, LLL d 'at' h:mm a");
      const suffix = event.isRecurring
        ? ` (occurrence #${event.occurrenceIndex})`
        : "";
      console.log(`  - ${event.summary}: ${formatted}${suffix}`);
    }

    console.log("\n=== Done ===");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
