# Notion CLI guide

Run `bun run cli notion ...` from the repository. After linking globally, use `notion ...`.
`notion --help`, group help, `methods`, and `skill` do not connect to the server.
Individual commands show arguments and examples with `--help`, and original server descriptions and nested JSON schemas with `--help=full`.
Run `notion access check` to inspect the connected account's tools and plan restrictions.
Calendar features, comment management, memory, and skill settings depend on the connection and plan.
Commands absent from the generated tool definitions do not appear in help.

See the [common usage guide](../../apps/cli/README.md) and [plugin development guide](../README.md).

## Calendars

1. Run `notion calendar list` to select an account and calendar.
2. Run `notion calendar event list --timeMin 2026-10-20T00:00:00+09:00 --timeMax 2026-10-21T00:00:00+09:00 --timeZone Asia/Seoul` to retrieve events.
3. Run `notion calendar contact search --queries '["teammate@example.com"]'` to check attendees.
4. Before writing, confirm the calendar, time zone, attendees, and changes.

`calendar event list-coworkers` returns event details for colleagues listed in the `--coworkerEmails` array.
`calendar room list` finds rooms available at the specified time for that calendar account.
Room queries require permission to read Google Workspace calendar resources.
Include the organizer in `minCapacity`.

Fill in the account and calendar IDs returned by `calendar list`, and save the following as `events.json`.

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

After confirmation, run `notion calendar event create --input-file events.json`.
For all-day events, use `period.type: "DATE"`, `start.date`, and `end.date`.
Creating, updating, or canceling events may notify attendees. Each request supports up to 50 events.

Use `calendar event update` to decline an event organized by someone else instead of canceling it.
Fill in the event identifiers returned by `calendar event list`, and save the following as `updates.json`.

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
To edit event content, inspect the current event and help, then use `updateType: "UPDATE"` with an `update` object.
To cancel an event you manage, place the same event identifiers in an `events` array and pass it to `calendar event cancel`.

## Comments and deletion

Before editing or replying, run `comment list` and use the returned comment or discussion ID.

- `comment create --reply-to-comment-id <id> --page-id <page-id> --markdown 'Thank you'`: add a reply
- `comment update --comment-id <id> --markdown 'Updated content'`: replace your entire comment
- `comment react --comment-id <id> --emoji '👍' --reacted`: add a reaction; remove it with `--no-reacted`
- `comment resolve --discussion-id <id> --resolved`: resolve a discussion; reopen it with `--no-resolved`

Resolve discussions only when the user explicitly requests it.
Editing, deleting, resolving, and reacting to comments require a Business or Enterprise plan.

`page delete --page-ids '["<id>"]'` previews pages to move to trash.
`database delete --database-ids '["<id>"]'` previews database deletion, including rows.
Show the preview to the user, obtain confirmation, and rerun with `--user-confirmed`.
Use `page restore` to restore pages and databases from trash.

## Files, memory, and skills

By default, `page get` returns uploaded files as `notion-file-block://` references.
`--include-file-urls` immediately retrieves signed URLs.
You can also pass references unchanged to `attachment urls --references '["<reference>"]'`.
Keep stable references in pages because signed URLs expire.
Use `page backlinks --page-id <id>` to find referring pages. Pass `next_cursor` as `--cursor` to continue.

Before using memory, run `notion resources read notion://docs/memory` once per conversation.
`memory search --query 'release preferences'` searches memory saved by connected agents.
For listing or filtering, use the data source returned by `page get --id memory`.
This feature is separate from the repository's [mem CLI](../../apps/mem/README.md).

`agent-skill list-enabled` lists skills available to external MCP clients.
Before loading a skill, inform the user and run `agent-skill download`.
To enable a skill, pass this JSON to `agent-skill update-enabled`:

```json
{
  "add_skill_urls": ["https://www.notion.so/<skill-page-id>"],
  "surfaces": ["mcp"]
}
```

Use `remove_skill_urls` to disable skills.
`surfaces` accepts `mcp` and `notion_ai`. Omitting it changes both.

## Page and database behavior

- Search filters retain their nested structure: `search workspace --query roadmap --filters.created_by_user_ids '["me"]'`.
- `page create` with `creation_mode: "draft"` creates a private page without a destination. Do not combine it with `parent`.
- `page update --command update_content` accepts `--content-updates '[{"old_str":"Draft","new_str":"Done"}]'`.
- Inspect update warnings. Only some matches may be updated, so retrieve the content again before retrying.
- Read `notion://docs/database-page-layouts` before replacing a layout with `data-source update --page-layout`.
- View settings support map, chart, and form directives. Retrieve existing settings before changing them.
- Wait for asynchronous operations with `task get`. Template content may require another `page get` check after the task succeeds.

`call <MCP-tool-name>` applies the same schemas and policies as mapped commands.
Two follow-up tools are available only through `call` because they process instructions included in tool results.
