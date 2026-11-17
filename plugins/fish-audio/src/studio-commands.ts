import type { CommandCustomization } from "@mcp-cli/core";

export const studioCommands: Record<string, CommandCustomization> = {
  studio_help: {
    path: ["studio", "manual"],
    summary: "Read the Story Studio manual; run this before the first studio command",
    examples: ["fish-audio studio manual", "fish-audio studio manual --topic billing"],
  },
  studio_list_projects: {
    path: ["studio", "project", "list"],
    summary: "List Story Studio projects, newest first",
  },
  studio_project: {
    path: ["studio", "project", "get"],
    summary: "Show a project's chapters, roster and import/export job state",
    examples: ["fish-audio studio project get --project-id <id>"],
  },
  studio_create_project: {
    path: ["studio", "project", "create"],
    summary: "Create a project from chapters, voice-acting scenes or a script import (free)",
  },
  studio_import_document: {
    path: ["studio", "project", "import"],
    summary: "Import a long document into a new project in the background (free)",
  },
  studio_update_project: {
    path: ["studio", "project", "update"],
    summary: "Rename a project, set defaults, audio settings or chapter order",
  },
  studio_export: {
    path: ["studio", "project", "export"],
    summary: "Quote, then export a project to an audio file (paid plan)",
  },
  studio_create_chapter: {
    path: ["studio", "chapter", "create"],
    summary: "Add a chapter with one empty block",
  },
  studio_update_chapter: {
    path: ["studio", "chapter", "update"],
    summary: "Rename a chapter; on voice-acting projects set its scene note and cast",
  },
  studio_read_blocks: {
    path: ["studio", "block", "read"],
    summary: "Read blocks of a chapter or by anchor",
  },
  studio_write_blocks: {
    path: ["studio", "block", "write"],
    summary: "Edit, insert, move or delete up to 100 blocks (free)",
  },
  studio_find: {
    path: ["studio", "block", "find"],
    summary: "Search block text across the project",
  },
  studio_enhance_text: {
    path: ["studio", "block", "enhance"],
    summary: "Polish one block's text for TTS with spoken numbers and delivery tags (free)",
  },
  studio_generate: {
    path: ["studio", "block", "generate"],
    summary: "Synthesize audio for blocks; run with --dry-run first for a quote",
    examples: ["fish-audio studio block generate --project-id <id> --dry-run"],
  },
  studio_list_takes: {
    path: ["studio", "take", "list"],
    summary: "List a block's generated takes",
  },
  studio_adopt_take: {
    path: ["studio", "take", "adopt"],
    summary: "Bind a previous take back to its block (free)",
  },
  studio_recast_speaker: {
    path: ["studio", "speaker", "recast"],
    summary: "Swap one voice for another across the whole project (free)",
  },
  studio_import_script: {
    path: ["studio", "script", "import"],
    summary: "Parse a voice-acting script into scenes, lines and roles for review (free)",
    rules: [
      "Create the project with studio project create --kind voice-acting --import-job-id <id>.",
    ],
  },
  studio_perform: {
    path: ["studio", "scene", "perform"],
    summary: "Quote, then perform a voice-acting scene's lines with Drama 3",
    rules: [
      "Call without --confirmed-credits for the quote; the confirmed call can take 90 s, never resend it.",
    ],
  },
  studio_retake: {
    path: ["studio", "take", "retake"],
    summary: "Quote, then re-take one voice-acting line with a direction note",
  },
  studio_rate_take: {
    path: ["studio", "take", "rate"],
    summary: "Record the user's thumbs up or down on a take (free)",
  },
  studio_share: {
    path: ["studio", "share", "update"],
    summary: "Create or move the project's public listening link",
    rules: ["The link is public; ask the user before creating or moving it."],
  },
  studio_share_comments: {
    path: ["studio", "share", "comments"],
    summary: "Read listener comments on the share link in playback order",
  },
};
