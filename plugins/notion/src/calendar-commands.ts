import type { CommandCustomization } from "@mcp-cli/core";

const at = (
  path: string,
  summary: string,
  examples: string[],
  rules: string[] = [],
): CommandCustomization => ({ path: path.split(" "), summary, examples, rules, optional: true });

const changes = [
  "Confirm the target calendar, event, time zone and requested change before writing.",
  "Creating, updating or canceling events may notify attendees.",
  "Use --input-file for event arrays; copy accountId, calendarId and eventId from list results.",
];

export const calendarCommands: Record<string, CommandCustomization> = {
  "notion-calendar-list-calendars": at(
    "calendar list",
    "List calendars and connected accounts before selecting a destination",
    ["notion calendar list"],
  ),
  "notion-calendar-list-events": at(
    "calendar event list",
    "List your events within an explicit time range and time zone",
    [
      "notion calendar event list --timeMin 2026-10-20T00:00:00+09:00 --timeMax 2026-10-21T00:00:00+09:00 --timeZone Asia/Seoul",
    ],
  ),
  "notion-calendar-list-coworkers-events": at(
    "calendar event list-coworkers",
    "Read coworkers' event details within a time range",
    [
      "notion calendar event list-coworkers --coworkerEmails '[\"teammate@example.com\"]' --timeMin 2026-10-20T00:00:00+09:00 --timeMax 2026-10-21T00:00:00+09:00 --timeZone Asia/Seoul",
    ],
    ["Use this for event context; the response contains event details, not only free/busy slots."],
  ),
  "notion-calendar-list-contacts": at(
    "calendar contact search",
    "Resolve attendee names or email addresses across connected accounts",
    ["notion calendar contact search --queries '[\"teammate@example.com\"]'"],
  ),
  "notion-calendar-list-calendar-resources": at(
    "calendar room list",
    "Find available rooms for specific time slots and a target calendar",
    ["notion calendar room list --input-file rooms.json"],
    [
      "Room discovery requires Google Workspace permission to view Calendar resources.",
      "Include the organizer in minCapacity and choose rooms from the event calendar's account.",
    ],
  ),
  "notion-calendar-create-events": at(
    "calendar event create",
    "Create events on a selected calendar; attendees may be notified",
    ["notion calendar event create --input-file events.json"],
    [
      ...changes,
      "Set timeZone and each event's summary and period, including its DATE or DATE_TIME type.",
    ],
  ),
  "notion-calendar-update-events": at(
    "calendar event update",
    "Change events or send an RSVP with the matching updateType",
    ["notion calendar event update --input-file updates.json"],
    [
      ...changes,
      "To decline an event you do not organize, use updateType RSVP with responseStatus declined.",
    ],
  ),
  "notion-calendar-cancel-events": at(
    "calendar event cancel",
    "Cancel identified events that you manage; attendees may be notified",
    ["notion calendar event cancel --input-file cancellations.json"],
    [...changes, "Use event update with an RSVP to decline someone else's event."],
  ),
};
