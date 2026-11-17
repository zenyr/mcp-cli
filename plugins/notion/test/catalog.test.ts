import { expect, test } from "bun:test";
import { applyCustomizations } from "@mcp-cli/core";
import { help, runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import notion from "../src";
import { manifest } from "../src/generated";

type Example = { path: string; tool: string; input: Record<string, unknown> };
const example = (path: string, tool: string, input: Record<string, unknown> = {}): Example => ({
  path,
  tool: `notion-${tool}`,
  input,
});
const calendar = { accountId: "account", calendarId: "calendar" };
const event = { calendar, eventId: "event" };
const time = {
  timeMin: "2026-10-20T00:00:00+09:00",
  timeMax: "2026-10-21T00:00:00+09:00",
  timeZone: "Asia/Seoul",
};
const uuid = "12345678-1234-4234-8234-123456789abc";
const examples: Example[] = [
  example("calendar list", "calendar-list-calendars"),
  example("calendar event list", "calendar-list-events", time),
  example("calendar event list-coworkers", "calendar-list-coworkers-events", {
    ...time,
    coworkerEmails: ["teammate@example.com"],
  }),
  example("calendar contact search", "calendar-list-contacts", {
    queries: ["teammate@example.com"],
  }),
  example("calendar room list", "calendar-list-calendar-resources", {
    calendar,
    timeSlots: [{ startAt: time.timeMin, endAt: time.timeMax }],
    minCapacity: 2,
    timeZone: time.timeZone,
  }),
  example("calendar event create", "calendar-create-events", {
    timeZone: time.timeZone,
    events: [
      {
        calendar,
        summary: "Review",
        period: {
          type: "DATE_TIME",
          start: { dateTime: "2026-10-20T10:00:00+09:00" },
          end: { dateTime: "2026-10-20T10:30:00+09:00" },
        },
      },
    ],
  }),
  example("calendar event update", "calendar-update-events", {
    timeZone: time.timeZone,
    updates: [{ updateType: "RSVP", event, rsvp: { responseStatus: "declined" } }],
  }),
  example("calendar event cancel", "calendar-cancel-events", { events: [event] }),
  example("account get", "get-self"),
  example("group list", "get-groups", { query: "engineering" }),
  example("page backlinks", "list-page-backlinks", { page_id: uuid, page_size: 25 }),
  example("attachment urls", "get-file-download-urls", {
    references: [`notion-file-block://${uuid}/${uuid}?space_id=${uuid}&name=notes.txt`],
  }),
  example("agent-skill list-enabled", "get-enabled-skills"),
  example("agent-skill update-settings", "update-skill-settings", {
    skill_url: `https://www.notion.so/${uuid}`,
    settings: { enabled: true, use_in_connected_agents: true },
  }),
  example("version changes", "get-version-changes", { page: uuid }),
  example("suggestion resolve", "resolve-suggested-edit", {
    suggested_edit_url: `https://www.notion.so/${uuid}`,
    action: "accept",
  }),
  example("page delete", "delete-pages", { page_ids: [uuid] }),
  example("database delete", "delete-databases", { database_ids: [uuid] }),
  example("comment update", "update-comment", { comment_id: uuid, markdown: "Corrected text" }),
  example("comment delete", "delete-comment", { comment_id: uuid }),
  example("comment resolve", "set-discussion-resolved", { discussion_id: uuid, resolved: false }),
  example("comment react", "set-comment-reaction", {
    comment_id: uuid,
    emoji: "👍",
    reacted: true,
  }),
];

test.each(examples)(
  "$path forwards the same input through mapped and raw commands",
  async ({ path, tool, input }) => {
    const f = recordingPorts();
    for (const command of [path.split(" "), ["call", tool]]) {
      expect(
        await runService(notion, manifest, [...command, "--input", JSON.stringify(input)], f.ports),
      ).toBe(0);
    }
    expect(f.calls).toEqual([
      { name: tool, input },
      { name: tool, input },
    ]);
    const text = help(applyCustomizations(notion, manifest), path.split(" "));
    expect(text).toContain("Examples:");
    expect(text).not.toContain("Unknown command");
  },
);

test("optional tools do not leave empty calendar groups or quickstart entries", () => {
  const tools = manifest.tools.filter((tool) => !notion.commands?.[tool.name]?.optional);
  const customized = applyCustomizations(notion, { ...manifest, tools });
  expect(customized.groups.calendar).toBeUndefined();
  expect(customized.quickstart.some((item) => item.command.startsWith("calendar "))).toBe(false);
});

test("documented JSON inputs pass schema validation and reach their tools", async () => {
  const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
  const blocks = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)];
  const commands = [
    { path: ["calendar", "event", "create"], tool: "notion-calendar-create-events" },
    { path: ["calendar", "event", "update"], tool: "notion-calendar-update-events" },
    { path: ["agent-skill", "update-settings"], tool: "notion-update-skill-settings" },
  ];
  expect(blocks).toHaveLength(commands.length);
  for (const [index, command] of commands.entries()) {
    const block = blocks[index]?.[1];
    if (!block) throw new Error("Missing documented JSON example");
    const f = recordingPorts();
    expect(
      await runService(notion, manifest, [...command.path, "--input-file", "example.json"], {
        ...f.ports,
        io: { ...f.ports.io, readFile: async () => block },
      }),
    ).toBe(0);
    expect(f.calls).toEqual([{ name: command.tool, input: JSON.parse(block) }]);
  }
});

test("help, methods and skill stay offline", async () => {
  const f = recordingPorts();
  for (const args of [["--help"], ["methods", "--json"], ["skill"]])
    expect(await runService(notion, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  expect(f.calls).toHaveLength(0);
});

test("flags preserve nested filters and comment state", async () => {
  const cases = [
    {
      args: [
        "search",
        "workspace",
        "--query",
        "roadmap",
        "--filters.created_by_user_ids",
        '["me"]',
      ],
      tool: "notion-search",
      input: { query: "roadmap", filters: { created_by_user_ids: ["me"] } },
    },
    {
      args: ["comment", "resolve", "--discussion-id", uuid, "--no-resolved"],
      tool: "notion-set-discussion-resolved",
      input: { discussion_id: uuid, resolved: false },
    },
  ];
  for (const { args, tool, input } of cases) {
    const f = recordingPorts();
    expect(await runService(notion, manifest, args, f.ports)).toBe(0);
    expect(f.calls).toEqual([{ name: tool, input }]);
  }
});
