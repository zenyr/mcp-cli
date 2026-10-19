# Notion CLI workflows

Run `bun run cli notion ...` from this checkout, or use `notion ...` after linking the CLI.
`notion --help`, group help, `methods` and `skill` stay offline.
Use `<command> --help` for concise arguments and examples, then `--help=full` for the complete server description and nested JSON schemas.
`notion access check` reports the connected account's available tools and plan limits.
Calendar, comment management, memory and skill settings may depend on the connection or plan.
Commands absent from a generated snapshot do not appear in help.

## Calendar

1. Run `notion calendar list` and select the account and calendar.
2. Run `notion calendar event list --timeMin 2026-10-20T00:00:00+09:00 --timeMax 2026-10-21T00:00:00+09:00 --timeZone Asia/Seoul`.
3. Resolve attendees with `calendar contact search --queries '["teammate@example.com"]'`.
4. Confirm the calendar, time zone, attendees and requested change before writing.

`calendar event list-coworkers` returns event details for the supplied `--coworkerEmails` array.
`calendar room list` checks specific time slots for available rooms in the event calendar's account.
Room discovery requires Google Workspace permission to view Calendar resources.
Include the organizer in `minCapacity`.

Save this as `events.json`, replacing the account and calendar IDs with values from `calendar list`:

```json
{
  "timeZone": "Asia/Seoul",
  "events": [
    {
      "calendar": { "accountId": "<account-id>", "calendarId": "<calendar-id>" },
      "summary": "Release review",
      "period": {
        "type": "DATE_TIME",
        "start": { "dateTime": "2026-10-20T10:00:00+09:00" },
        "end": { "dateTime": "2026-10-20T10:30:00+09:00" }
      },
      "attendees": [{ "email": "teammate@example.com" }]
    }
  ]
}
```

Run `notion calendar event create --input-file events.json` after confirmation.
For all-day events, use `period.type: "DATE"` and `start.date` / `end.date`.
Create, update and cancel can notify attendees.
Commands accept batches of up to 50 events.

To decline someone else's event, use `calendar event update`, not cancel.
Save this as `updates.json`, replacing the event identity from `calendar event list`:

```json
{
  "timeZone": "Asia/Seoul",
  "updates": [
    {
      "updateType": "RSVP",
      "event": {
        "calendar": { "accountId": "<account-id>", "calendarId": "<calendar-id>" },
        "eventId": "<event-id>"
      },
      "rsvp": { "responseStatus": "declined" }
    }
  ]
}
```

Run `notion calendar event update --input-file updates.json`.
For event content changes, use `updateType: "UPDATE"` with an `update` object; inspect command help and the current event first.
To cancel an event you manage, pass `calendar event cancel` an `events` array containing the same event identities.

## Comments and deletion

Run `comment list` before editing or replying, and use the returned comment or discussion ID.
`comment create --reply-to-comment-id <id> --page-id <page-id> --markdown 'Thanks'` replies to a comment.
`comment update --comment-id <id> --markdown 'Corrected text'` replaces the entire text of your comment.
`comment react --comment-id <id> --emoji '👍' --reacted` adds a reaction; `--no-reacted` removes it.
`comment resolve --discussion-id <id> --resolved` resolves a discussion; `--no-resolved` reopens it.
Resolve discussions only when a human explicitly asks.
Comment update, delete, resolve and react require Business or Enterprise.

`page delete --page-ids '["<id>"]'` previews the pages that would move to Trash.
`database delete --database-ids '["<id>"]'` previews databases, including their rows.
Show the preview and obtain confirmation before retrying with `--user-confirmed`.
Use `page restore` to restore trashed pages or databases.

## Files, memory and skills

`page get` now uses stable `notion-file-block://` references for uploaded files by default.
Pass `--include-file-urls` to fetch signed URLs immediately, or copy the exact references to `attachment urls --references '["<reference>"]'`.
Signed URLs expire; preserve the stable references in page content.
Use `page backlinks --page-id <id>` to find referring pages, then follow `next_cursor` with `--cursor`.

Before using memory, run `notion resources read notion://docs/memory` once per conversation.
`memory search --query 'release preferences'` finds memories saved by connected agents.
To list or filter memories, use `page get --id memory`, then query the returned data source.

`agent-skill list-enabled` lists skills available to external MCP clients.
Tell the user before loading a skill, then use `agent-skill download`.
To enable or disable skills, pass `agent-skill update-enabled` a JSON object:

```json
{
  "add_skill_urls": ["https://www.notion.so/<skill-page-id>"],
  "surfaces": ["mcp"]
}
```

Use `remove_skill_urls` to disable a skill.
`surfaces` accepts `mcp` and `notion_ai`; omitting it changes both.

## Updated page and database behavior

- Keep search filters nested: `search workspace --query roadmap --filters.created_by_user_ids '["me"]'`.
- `page create` accepts `creation_mode: "draft"` for a private page without a named destination; do not combine it with `parent`.
- `page update --command update_content` accepts `--content-updates '[{"old_str":"Draft","new_str":"Ready"}]'`.
- Inspect update warnings: matching operations can succeed while others fail to match; fetch again before retrying.
- Read `notion://docs/database-page-layouts` before replacing a layout with `data-source update --page-layout`.
- View configuration supports map, chart and form directives; inspect existing settings before changing them.
- Wait for async tasks with `task get`; template content may require further `page get` checks after task success.

`call <MCP-tool-name>` reaches the same schema and policies as each mapped command.
The two next-steps tools remain under `call` because they answer instructions inside tool results.
