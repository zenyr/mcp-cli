import type { CommandCustomization } from "@mcp-cli/core";

const at = (
  path: string,
  summary: string,
  examples: string[],
  rules: string[] = [],
): CommandCustomization => ({ path: path.split(" "), summary, examples, rules, optional: true });

export const workspaceCommands: Record<string, CommandCustomization> = {
  "notion-get-self": at("account get", "Identify the connected workspace and user", [
    "notion account get",
  ]),
  "notion-get-groups": at("group list", "Find permission groups for People properties", [
    "notion group list --query engineering",
  ]),
  "notion-list-page-backlinks": at(
    "page backlinks",
    "List pages that link to or mention a page",
    ["notion page backlinks --page-id <page-id> --page-size 25"],
    ["Follow next_cursor with --cursor; fetch a linked page to read its contents."],
  ),
  "notion-get-file-download-urls": at(
    "attachment urls",
    "Resolve stable file references into temporary download URLs",
    ["notion attachment urls --references '[\"notion-file-block://<reference-from-page>\"]'"],
    [
      "Copy references exactly from page get; preserve stable references when editing Markdown.",
      "URLs expire within minutes; resolve references again when needed (up to 25 per call).",
    ],
  ),
  "notion-get-enabled-skills": at(
    "agent-skill list-enabled",
    "List skills enabled for external MCP clients",
    ["notion agent-skill list-enabled"],
    ["Tell the user before loading a listed skill, then download it with agent-skill download."],
  ),
  "notion-update-skill-settings": at(
    "agent-skill update-settings",
    "Enable, disable or place one skill, including for MCP clients",
    [
      'notion agent-skill update-settings --skill-url https://www.notion.so/<skill-page-id> --settings \'{"enabled":true,"use_in_connected_agents":true}\'',
    ],
    [
      "Only the provided settings change; disabling a skill also clears its placements and MCP use.",
    ],
  ),
  "notion-delete-pages": at(
    "page delete",
    "Move specified pages or database rows to Trash",
    ["notion page delete --page-ids '[\"<page-id>\"]'"],
    [
      "Only delete pages the user explicitly asked to delete.",
      "Without --user-confirmed, the server returns a preview and moves nothing.",
      "Show the preview, obtain confirmation, then repeat with --user-confirmed; use page restore to recover.",
    ],
  ),
  "notion-delete-databases": at(
    "database delete",
    "Move databases and all their rows to Trash",
    ["notion database delete --database-ids '[\"<database-id>\"]'"],
    [
      "Only delete databases the user explicitly asked to delete, never a linked view.",
      "Preview without --user-confirmed, show all affected databases and obtain confirmation before retrying.",
      "Use page delete for individual rows and page restore to recover trashed databases.",
    ],
  ),
  "notion-update-comment": at(
    "comment update",
    "Replace the full text of a comment you wrote",
    ['notion comment update --comment-id <comment-id> --markdown "Corrected text"'],
    [
      "Requires Business or Enterprise; get the ID with comment list and send the full replacement text.",
    ],
  ),
  "notion-delete-comment": at(
    "comment delete",
    "Delete a comment you wrote",
    ["notion comment delete --comment-id <comment-id>"],
    [
      "Requires Business or Enterprise; deleting the last comment also removes its discussion.",
      "Use comment update to fix text; delete only when the user asks.",
    ],
  ),
  "notion-set-discussion-resolved": at(
    "comment resolve",
    "Resolve or reopen a discussion at the user's request",
    [
      "notion comment resolve --discussion-id <discussion-id> --resolved",
      "notion comment resolve --discussion-id <discussion-id> --no-resolved",
    ],
    [
      "Requires Business or Enterprise; use discussion_id from comment list.",
      "Resolve only when a human explicitly requests it; completing work does not imply resolution.",
    ],
  ),
  "notion-set-comment-reaction": at(
    "comment react",
    "Add or remove your emoji reaction on a comment",
    [
      'notion comment react --comment-id <comment-id> --emoji "👍" --reacted',
      'notion comment react --comment-id <comment-id> --emoji "👍" --no-reacted',
    ],
    ["Requires Business or Enterprise; repeating the same state is safe."],
  ),
  "notion-create-suggested-edit": at(
    "suggestion create",
    "Propose one reviewable change without editing the page",
    ['notion suggestion create --page-id <page-id> --old-text "Draft" --new-text "Ready"'],
    ["Requires Business or Enterprise; copy old_text exactly from page get."],
  ),
  "notion-get-suggested-edit": at(
    "suggestion get",
    "Show a pending suggestion's diff and allowed actions",
    ["notion suggestion get --suggested-edit-url <url>"],
  ),
  "notion-resolve-suggested-edit": at(
    "suggestion resolve",
    "Accept or reject one pending suggestion",
    ["notion suggestion resolve --suggested-edit-url <url> --action accept"],
    ["Inspect it with suggestion get, then resolve only after the user chooses."],
  ),
  "notion-get-version-changes": at(
    "version changes",
    "List what changed in a page or database and who changed it",
    ["notion version changes --page <url-or-id>"],
    ["The range defaults to the last 24 hours."],
  ),
  "notion-view-version": at("version get", "Read a page or database as it looked at a past time", [
    "notion version get --page <url-or-id> --time 2026-11-01T09:00:00Z",
  ]),
  "notion-restore-version": at(
    "version restore",
    "Restore a whole page or database to a past time",
    ["notion version restore --page <url-or-id> --time 2026-11-01T09:00:00Z"],
    [
      "This undoes everyone's later edits; list version changes since that time and get confirmation first.",
    ],
  ),
  "notion-get-sidebar-tabs": at(
    "sidebar get",
    "Show your sidebar tabs and the shortcuts and sections you can add",
    ["notion sidebar get"],
  ),
  "notion-update-sidebar-tabs": at(
    "sidebar update",
    "Replace your complete, ordered sidebar tab list",
    ["notion sidebar update --input-file tabs.json"],
    ["Run sidebar get first and send back every item to keep; omitted items are removed."],
  ),
  "notion-update-page-favorites": at(
    "page favorite",
    "Favorite or unfavorite up to 100 pages or databases",
    ["notion page favorite --page-urls '[\"<page-url>\"]' --favorited"],
  ),
  "notion-create-meeting-note": at(
    "meeting-notes create",
    "Create a meeting note, optionally for a calendar event",
    ['notion meeting-notes create --title "Weekly sync" --content "## Agenda"'],
    [
      "Omit parent unless the user names a destination; find scheduled meetings with calendar event list.",
    ],
  ),
  "notion-convert-to-meetings-database": at(
    "meeting-notes convert-database",
    "Turn a regular database into a Meetings database",
    ["notion meeting-notes convert-database --databaseUrl <database-url>"],
    ["Ask the user before converting a database."],
  ),
  "notion-link-meeting-note-to-calendar-event": at(
    "meeting-notes link-event",
    "Link an existing meeting note to a calendar event",
    ["notion meeting-notes link-event --input-file link.json"],
  ),
};
