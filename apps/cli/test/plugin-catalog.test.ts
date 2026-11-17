import { expect, test } from "bun:test";
import { applyCustomizations, type ToolSession } from "@mcp-cli/core";
import { help, runService } from "@mcp-cli/runtime";
import notion from "../../../plugins/notion/src";
import { manifest as notionManifest } from "../../../plugins/notion/src/generated";
import fish from "../../../plugins/fish-audio/src";
import { manifest as fishManifest } from "../../../plugins/fish-audio/src/generated";
import linear from "../../../plugins/linear/src";
import { manifest as linearManifest } from "../../../plugins/linear/src/generated";
import slack from "../../../plugins/slack/src";
import { manifest as slackManifest } from "../../../plugins/slack/src/generated";

const services = {
  notion: { plugin: notion, manifest: notionManifest },
  fish: { plugin: fish, manifest: fishManifest },
  linear: { plugin: linear, manifest: linearManifest },
  slack: { plugin: slack, manifest: slackManifest },
};
type Service = keyof typeof services;
type Example = { service: Service; path: string; tool: string; input: Record<string, unknown> };
const notionCase = (path: string, tool: string, input: Record<string, unknown> = {}): Example => ({
  service: "notion",
  path,
  tool: `notion-${tool}`,
  input,
});
const fishCase = (path: string, tool: string, input: Record<string, unknown> = {}): Example => ({
  service: "fish",
  path,
  tool,
  input: { workspace_id: "workspace", ...input },
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
  notionCase("calendar list", "calendar-list-calendars"),
  notionCase("calendar event list", "calendar-list-events", time),
  notionCase("calendar event list-coworkers", "calendar-list-coworkers-events", {
    ...time,
    coworkerEmails: ["teammate@example.com"],
  }),
  notionCase("calendar contact search", "calendar-list-contacts", {
    queries: ["teammate@example.com"],
  }),
  notionCase("calendar room list", "calendar-list-calendar-resources", {
    calendar,
    timeSlots: [{ startAt: time.timeMin, endAt: time.timeMax }],
    minCapacity: 2,
    timeZone: time.timeZone,
  }),
  notionCase("calendar event create", "calendar-create-events", {
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
  notionCase("calendar event update", "calendar-update-events", {
    timeZone: time.timeZone,
    updates: [{ updateType: "RSVP", event, rsvp: { responseStatus: "declined" } }],
  }),
  notionCase("calendar event cancel", "calendar-cancel-events", { events: [event] }),
  notionCase("account get", "get-self"),
  notionCase("group list", "get-groups", { query: "engineering" }),
  notionCase("page backlinks", "list-page-backlinks", { page_id: uuid, page_size: 25 }),
  notionCase("attachment urls", "get-file-download-urls", {
    references: [`notion-file-block://${uuid}/${uuid}?space_id=${uuid}&name=notes.txt`],
  }),
  notionCase("agent-skill list-enabled", "get-enabled-skills"),
  notionCase("agent-skill update-settings", "update-skill-settings", {
    skill_url: `https://www.notion.so/${uuid}`,
    settings: { enabled: true, use_in_connected_agents: true },
  }),
  notionCase("version changes", "get-version-changes", { page: uuid }),
  notionCase("suggestion resolve", "resolve-suggested-edit", {
    suggested_edit_url: `https://www.notion.so/${uuid}`,
    action: "accept",
  }),
  notionCase("page delete", "delete-pages", { page_ids: [uuid] }),
  notionCase("database delete", "delete-databases", { database_ids: [uuid] }),
  notionCase("comment update", "update-comment", { comment_id: uuid, markdown: "Corrected text" }),
  notionCase("comment delete", "delete-comment", { comment_id: uuid }),
  notionCase("comment resolve", "set-discussion-resolved", {
    discussion_id: uuid,
    resolved: false,
  }),
  notionCase("comment react", "set-comment-reaction", {
    comment_id: uuid,
    emoji: "👍",
    reacted: true,
  }),
  fishCase("asset list", "list_assets", { search: "portrait", kinds: ["image"] }),
  fishCase("asset get", "get_asset", { asset_id: "asset" }),
  fishCase("asset save", "save_asset", { source_task_id: "task", title: "Portrait" }),
  fishCase("asset update", "update_asset", { asset_id: "asset", collection_id: null }),
  fishCase("asset collection list", "list_asset_collections", { all: true }),
  fishCase("asset collection get", "get_asset_collection", { collection_id: "collection" }),
  fishCase("asset collection update", "update_asset_collection", {
    collection_id: "collection",
    name: "References",
  }),
  fishCase("asset folder create", "create_asset_folder", { name: "References", request_id: uuid }),
  fishCase("asset avatar create", "create_avatar", {
    name: "Presenter",
    object_key: "portrait.png",
    request_id: uuid,
  }),
];

const unavailable = async (): Promise<never> => {
  throw new Error("Unexpected catalog or file access");
};
const fixture = () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const output: string[] = [];
  const session: ToolSession = {
    listTools: unavailable,
    listResources: unavailable,
    listResourceTemplates: unavailable,
    readResource: unavailable,
    listPrompts: unavailable,
    getPrompt: unavailable,
    callTool: async (name, input) => {
      calls.push({ name, input });
      return { content: [{ type: "text", text: "ok" }] };
    },
    close: async () => {},
  };
  return {
    calls,
    output,
    ports: {
      open: async () => session,
      io: {
        write: (text: string) => {
          output.push(text);
        },
        writeError: unavailable,
        readFile: unavailable,
        readBytes: unavailable,
        readStdin: unavailable,
      },
    },
  };
};

test.each(examples)(
  "$service $path forwards the same input through mapped and raw commands",
  async ({ service, path, tool, input }) => {
    const { plugin, manifest } = services[service];
    const f = fixture();
    for (const command of [path.split(" "), ["call", tool]]) {
      expect(
        await runService(plugin, manifest, [...command, "--input", JSON.stringify(input)], f.ports),
      ).toBe(0);
    }
    expect(f.calls).toEqual([
      { name: tool, input },
      { name: tool, input },
    ]);
    const text = help(applyCustomizations(plugin, manifest), path.split(" "));
    expect(text).toContain("Examples:");
    expect(text).not.toContain("Unknown command");
  },
);

test("optional Notion tools do not leave empty calendar groups or quickstart entries", () => {
  const tools = notionManifest.tools.filter((tool) => !notion.commands?.[tool.name]?.optional);
  const manifest = applyCustomizations(notion, { ...notionManifest, tools });
  expect(manifest.groups.calendar).toBeUndefined();
  expect(manifest.quickstart.some((item) => item.command.startsWith("calendar "))).toBe(false);
});

test("Notion's documented JSON inputs pass schema validation and reach their tools", async () => {
  const readme = await Bun.file(
    new URL("../../../plugins/notion/README.md", import.meta.url),
  ).text();
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
    const f = fixture();
    expect(
      await runService(notion, notionManifest, [...command.path, "--input-file", "example.json"], {
        ...f.ports,
        io: { ...f.ports.io, readFile: async () => block },
      }),
    ).toBe(0);
    expect(f.calls).toEqual([{ name: command.tool, input: JSON.parse(block) }]);
  }
});

test("help, methods and skill stay offline for every service", async () => {
  for (const { plugin, manifest } of Object.values(services)) {
    const f = fixture();
    for (const args of [["--help"], ["methods", "--json"], ["skill"]]) {
      expect(await runService(plugin, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
    }
    expect(f.calls).toHaveLength(0);
  }
});

test("updated flags preserve nulls, batches, nested filters and comment state", async () => {
  const cases: Array<{
    service: Service;
    args: string[];
    tool: string;
    input: Record<string, unknown>;
  }> = [
    {
      service: "fish",
      args: ["media", "job", "status", "--generation-ids", '["one","two"]'],
      tool: "get_generation_status",
      input: { generation_ids: ["one", "two"] },
    },
    {
      service: "fish",
      args: [
        "asset",
        "update",
        "--input",
        '{"workspace_id":"workspace","asset_id":"asset","collection_id":null}',
      ],
      tool: "update_asset",
      input: { workspace_id: "workspace", asset_id: "asset", collection_id: null },
    },
    {
      service: "notion",
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
      service: "notion",
      args: ["comment", "resolve", "--discussion-id", uuid, "--no-resolved"],
      tool: "notion-set-discussion-resolved",
      input: { discussion_id: uuid, resolved: false },
    },
    {
      service: "linear",
      args: ["project", "save", "--input", '{"id":"project","targetDate":null}'],
      tool: "save_project",
      input: { id: "project", targetDate: null },
    },
    {
      service: "linear",
      args: ["issue", "list", "--team", "ENG", "--includeSubTeams"],
      tool: "list_issues",
      input: { team: "ENG", includeSubTeams: true },
    },
  ];
  for (const { service, args, tool, input } of cases) {
    const { plugin, manifest } = services[service];
    const f = fixture();
    expect(await runService(plugin, manifest, args, f.ports)).toBe(0);
    expect(f.calls).toEqual([{ name: tool, input }]);
  }
});
