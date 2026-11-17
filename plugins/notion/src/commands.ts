import type { CommandCustomization, QuickstartEntry } from "@mcp-cli/core";
import { calendarCommands } from "./calendar-commands";
import { workspaceCommands } from "./workspace-commands";

const at = (path: string, summary: string, examples?: string[]): CommandCustomization => ({
  path: path.split(" "),
  summary,
  ...(examples && { examples }),
});

// The two setup-flow tools return instructions to follow, so they stay under `call`.
export const commands: Record<string, CommandCustomization> = {
  ...calendarCommands,
  ...workspaceCommands,
  "notion-get-tool-access": at(
    "access check",
    "Show tool availability and limits; run once before the first search",
    ["notion access check"],
  ),
  "notion-search": {
    ...at("search workspace", "Keyword search for pages, databases and users", [
      "notion search workspace --query roadmap --query-type internal",
      "notion search workspace --query jane@example.com --query-type user",
      "notion search workspace --query roadmap --filters.created_by_user_ids '[\"me\"]'",
    ]),
    rules: [
      "Keep exact filters inside --filters or use --input; omit unused filters to avoid unnecessary plan requirements.",
    ],
  },
  "notion-ai-search": {
    ...at(
      "search ai",
      "AI search across Notion and connected sources when access check reports it available",
    ),
    optional: true,
  },
  "notion-fetch": {
    ...at("page get", "Fetch a page, database, data source or view by URL or ID", [
      "notion page get --id https://www.notion.so/<page>",
      "notion page get --id <page-id> --include-file-urls",
    ]),
    rules: [
      "Uploaded files use stable notion-file-block:// references by default; resolve them with attachment urls or request --include-file-urls.",
    ],
  },
  "notion-create-pages": {
    ...at("page create", "Create pages under a parent or as private drafts", [
      "notion page create --input-file pages.json",
    ]),
    rules: [
      "Use creation_mode draft for a requested durable page with no destination; do not combine it with parent.",
      "Wait for task get to succeed before dependent actions; template content may need additional page get checks.",
    ],
  },
  "notion-update-page": {
    ...at("page update", "Update page properties or content with one --command", [
      'notion page update --page-id <id> --command insert_content --content "## Notes"',
      'notion page update --page-id <id> --command update_content --content-updates \'[{"old_str":"Draft","new_str":"Ready"}]\'',
    ]),
    rules: [
      "Inspect warnings: update_content can apply matching edits while reporting unmatched edits.",
      "Fetch the page again before retrying; already applied replacements may no longer match.",
      "Show any child-page deletion preview and get confirmation before --allow-deleting-content.",
    ],
  },
  "notion-duplicate-page": at("page duplicate", "Duplicate a page"),
  "notion-move-pages": at("page move", "Move pages or databases to a new parent"),
  "notion-restore-pages": at("page restore", "Restore pages or databases from Trash"),
  "notion-list-recent-pages": at("page list-recent", "List recently viewed pages and databases"),
  "notion-list-favorite-pages": at("page list-favorites", "List favorite pages in sidebar order"),
  "notion-list-private-pages": at("page list-private", "List top-level Private sidebar pages"),
  "notion-list-shared-pages": at("page list-shared", "List Shared sidebar pages"),
  "notion-get-comments": at("comment list", "List comments and discussions on a page"),
  "notion-create-comment": {
    ...at("comment create", "Comment on a page, quote or existing comment", [
      'notion comment create --page-id <page-id> --reply-to-comment-id <comment-id> --markdown "Thanks for the details"',
    ]),
    rules: [
      "Provide exactly one of markdown or rich_text; use comment list to obtain reply IDs.",
      "An unmatched selection-with-ellipsis fails; it does not fall back to a page comment.",
    ],
  },
  "notion-create-database": at(
    "database create",
    "Create a database from SQL DDL or a typed preset",
  ),
  "notion-query-data-sources": at("data-source query", "Query a data source by rows, SQL or view"),
  "notion-query-multiple-data-sources": at(
    "data-source query-multiple",
    "Run read-only SQLite SQL across several data sources",
  ),
  "notion-update-data-source": at("data-source update", "Change a data source's schema or layout"),
  "notion-create-view": at("view create", "Create a database view"),
  "notion-update-view": at("view update", "Change a view's name, filters, sorts or display"),
  "notion-query-meeting-notes": at("meeting-notes query", "Query your meeting notes"),
  "notion-create-folder": at("folder create", "Create an empty folder"),
  "notion-update-folder": at("folder update", "Update a folder"),
  "notion-create-attachment": at("attachment create", "Upload an attachment to Notion"),
  "notion-download-attachment": at("attachment download", "Download a small UTF-8 text attachment"),
  "notion-create-file-upload": at("upload create", "Get a short-lived URL to upload a local file"),
  "notion-get-users": at("user list", "List workspace members and guests"),
  "notion-get-teams": at("team list", "List teamspaces and your membership"),
  "notion-get-async-task": at("task get", "Check an async task started by another command"),
  "notion-convert-page-to-skill": at("agent-skill convert", "Mark an existing page as a skill"),
  "notion-download-skill": at("agent-skill download", "Download a skill as a tar.gz archive"),
  "notion-upload-skill": at(
    "agent-skill upload",
    "Import a skill directory into a Skills database",
  ),
  "notion-search-agents": at("agent search", "Search Custom Agents"),
  "notion-spawn-session": at("session spawn", "Start a session with a published Custom Agent"),
  "notion-send-message-to-session": at("session send", "Send a follow-up message to a session"),
  "notion-get-session-status": at("session status", "Get a session's latest turn status"),
  "notion-wait-session": at("session wait", "Wait until a session's latest turn stops"),
  "notion-stop-session": at("session stop", "Stop a running session"),
  "notion-query-sessions": at("session list", "List agent sessions with filters and sorting"),
  "notion-search-sessions": at("session search", "Search past sessions by topic"),
  "notion-list-session-events": at("session list-events", "List event summaries in a session"),
  "notion-read-session-event": at("session read-event", "Read one session event in full"),
};

export const groups: Record<string, string> = {
  access: "Tool availability and plan limits",
  search: "Find pages, databases and users",
  page: "Fetch, create, edit and organize pages",
  comment: "Page comments and discussions",
  database: "Create databases or move them to Trash",
  "data-source": "Query and change database data sources",
  view: "Database views",
  "meeting-notes": "Create, query and link meeting notes",
  folder: "Folders",
  attachment: "Attachments",
  upload: "File uploads",
  user: "Workspace members",
  team: "Teamspaces",
  task: "Async task status",
  "agent-skill": "Notion pages used as agent skills",
  agent: "Custom Agents",
  session: "Custom Agent sessions",
  account: "Connected workspace and user",
  group: "Permission groups used by People properties",
  suggestion: "Reviewable suggested edits",
  version: "Page and database version history",
  sidebar: "Your sidebar tabs",
  calendar: "Connected calendars, events, contacts and rooms",
  "calendar event": "Read schedules, create events and manage invitations",
  "calendar contact": "Resolve attendees",
  "calendar room": "Available meeting rooms",
};

export const quickstart: QuickstartEntry[] = [
  { command: "access check", summary: "Run once before the first search" },
  { command: "search workspace --query <keywords>", summary: "Find a page or database" },
  { command: "page get --id <url-or-id>", summary: "Read a page before editing it" },
  { command: "page list-recent", summary: "Pick up recently viewed pages" },
  { command: "calendar list", summary: "Find a calendar before working with events" },
];

export const skill = [
  "Discover: notion --help -> <noun> --help -> <noun> <verb> --help.",
  "Before unfamiliar ops: --help=full (server instructions/nested schemas); methods [group]: concise tool mappings.",
  "",
  "Workflows:",
  "Find: access check once -> search workspace (or search ai if available) -> page get.",
  "Edit: page get -> page update with one --command; before content edits, read notion://docs/enhanced-markdown-spec.",
  "Databases: page get database -> data-source query; saved views: view create/update.",
  "Layouts: before data-source update --page-layout, read notion://docs/database-page-layouts; replaces layout.",
  "Views: --configure accepts map/chart/form settings; inspect current view before edits.",
  "Files: page get -> attachment urls with exact notion-file-block:// refs; signed URLs expire.",
  "Comments: comment list -> comment create --reply-to-comment-id or comment update with full replacement text.",
  "History: version changes -> version get; version restore only after listing changes and confirmation.",
  "Suggestions: page get -> suggestion create; review: suggestion get -> user choice -> suggestion resolve.",
  "Skills: agent-skill list-enabled -> tell user skill to load -> agent-skill download; settings: agent-skill update-settings.",
  "Calendar: calendar list -> calendar event list with explicit timeMin/timeMax/timeZone -> confirm -> create/update/cancel.",
  "Attendees: calendar contact search; details: calendar event list-coworkers; rooms: calendar room list.",
  "Async: page create/update may return tasks -> task get.",
  "",
  "Rules:",
  "User confirmation before replace_content, page move, or content deletion.",
  "page delete/database delete preview without --user-confirmed; show user preview before retry confirmation.",
  "Calendar writes may notify attendees; decline others' events: event update with RSVP, not event cancel.",
  "Resolve comment discussions: explicit human request only; comment update/delete/resolve/react require Business or Enterprise.",
  "agent-skill update-settings changes only provided settings; disabling clears placements and MCP use.",
  "Setup: call notion-get-setup-guide only when the user asks to set up Notion.",
  "Tools vary by connection/plan; access check: availability; optional commands may be absent.",
  "Nested args (pages/properties/etc.): --input or --input-file.",
].join("\n");
