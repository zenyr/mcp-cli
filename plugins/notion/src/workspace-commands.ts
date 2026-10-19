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
  "notion-memory-search": at(
    "memory search",
    "Search context, preferences and decisions saved by connected agents",
    ['notion memory search --query "release preferences" --limit 10'],
    [
      "Read notion://docs/memory once with resources read before using memory in a conversation.",
      "To list or filter all memories, page get --id memory, then query its data source.",
    ],
  ),
  "notion-get-enabled-skills": at(
    "agent-skill list-enabled",
    "List skills enabled for external MCP clients",
    ["notion agent-skill list-enabled"],
    ["Tell the user before loading a listed skill, then download it with agent-skill download."],
  ),
  "notion-update-enabled-skills": at(
    "agent-skill update-enabled",
    "Enable or disable skills for selected surfaces",
    ["notion agent-skill update-enabled --input-file skills.json"],
    [
      "Set surfaces explicitly to limit the change; omitting it affects Notion AI and external MCP clients.",
      "Use add_skill_urls and remove_skill_urls for the current user's settings.",
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
};
