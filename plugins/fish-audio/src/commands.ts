import type { CommandCustomization, QuickstartEntry } from "@mcp-cli/core";

// Paths follow `fish-audio <noun> [sub-noun] <verb>`; get_audio_data is a player helper and stays under `call`.
export const commands: Record<string, CommandCustomization> = {
  text_to_speech: {
    path: ["speech", "create"],
    summary: "Generate speech from text and return an audio URL (1 credit per UTF-8 byte)",
    examples: [
      'fish-audio speech create --text "Hello there" --language en',
      'fish-audio speech create --text "[excited] 안녕하세요" --voice-id <voice-id>',
    ],
  },
  speech_to_text: {
    path: ["transcription", "create"],
    summary: "Transcribe audio from a public https URL",
    examples: [
      "fish-audio transcription create --audio-url https://example.com/a.mp3 --model flash",
    ],
  },
  search_voices: {
    path: ["voice", "search"],
    summary: "Search public voices, or your own with --self",
    examples: [
      "fish-audio voice search --language ko",
      "fish-audio voice search --query narrator --sort-by task_count",
      "fish-audio voice search --self",
    ],
  },
  get_voice: {
    path: ["voice", "get"],
    summary: "Show one voice with its sample audio and languages",
    examples: ["fish-audio voice get --voice-id <voice-id>"],
  },
  create_voice_clone: {
    path: ["voice", "clone"],
    summary: "Clone a voice from 1-5 sample audio URLs of one speaker (free)",
  },
  verify_voice_clone: {
    path: ["voice", "verify"],
    summary: "Finish speaker verification for a clone that requires it",
  },
  get_upload_url: {
    path: ["upload", "audio"],
    summary: "Get an upload slot for a local audio file (for transcription or cloning)",
    examples: ["fish-audio upload audio --filename sample.mp3"],
  },
  create_media_upload: {
    path: ["upload", "media"],
    summary: "Get a workspace upload slot for an image, video or audio media input",
  },
  get_credit_balance: {
    path: ["account", "balance"],
    summary: "Show plan, remaining credits and the per-call TTS text budget",
    examples: ["fish-audio account balance"],
  },
  list_my_workspaces: {
    path: ["account", "workspaces"],
    summary: "List workspaces; media commands need a workspace id",
  },
  submit_feedback: {
    path: ["feedback", "send"],
    summary: "Send a short note about these tools to the Fish Audio team",
  },
  list_media_models: {
    path: ["media", "model", "list"],
    summary: "List image and video models with capabilities and default prices",
  },
  get_media_model: {
    path: ["media", "model", "get"],
    summary: "Show one model's parameter schema and accepted inputs",
  },
  estimate_image_generation: {
    path: ["media", "image", "estimate"],
    summary: "Estimate and validate an image generation (read-only)",
  },
  generate_image: {
    path: ["media", "image", "create"],
    summary: "Submit an image generation with the estimated parameters (charges credits)",
  },
  estimate_image_edit: {
    path: ["media", "image-edit", "estimate"],
    summary: "Estimate and validate an image edit or upscale (read-only)",
  },
  generate_image_edit: {
    path: ["media", "image-edit", "create"],
    summary: "Submit an image edit with the estimated parameters (charges credits)",
  },
  estimate_video_generation: {
    path: ["media", "video", "estimate"],
    summary: "Estimate and validate a video, lip sync or avatar generation (read-only)",
  },
  generate_video: {
    path: ["media", "video", "create"],
    summary: "Submit a video generation with the estimated parameters (charges credits)",
  },
  get_generation_status: {
    path: ["media", "job", "status"],
    summary: "Poll a media generation's status and billing",
    examples: ["fish-audio media job status --generation-id <id>"],
  },
  get_generation_result: {
    path: ["media", "job", "result"],
    summary: "Get a finished media generation's outputs and billing",
  },
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
    summary: "Create a project from structured chapters, up to 200 blocks (free)",
  },
  studio_import_document: {
    path: ["studio", "project", "import"],
    summary: "Import a long document into a new project in the background (free)",
  },
  studio_update_project: {
    path: ["studio", "project", "update"],
    summary: "Rename a project, set defaults or reorder chapters",
  },
  studio_export: {
    path: ["studio", "project", "export"],
    summary: "Quote, then export a project to an audio file (paid plan)",
  },
  studio_create_chapter: {
    path: ["studio", "chapter", "create"],
    summary: "Add a chapter with one empty block",
  },
  studio_update_chapter: { path: ["studio", "chapter", "update"], summary: "Rename a chapter" },
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
};

export const groups: Record<string, string> = {
  speech: "Text-to-speech",
  transcription: "Speech-to-text",
  voice: "Search, inspect and clone voices",
  upload: "Upload slots for local files; send the returned URL to other commands",
  account: "Plan, credits and workspaces",
  feedback: "Feedback to the Fish Audio team",
  media: "Image and video generation; estimate before create",
  "media model": "Image and video models and their parameters",
  "media image": "Text-to-image generation",
  "media image-edit": "Image edit and upscale",
  "media video": "Video, lip sync and talking avatar generation",
  "media job": "Status and results of submitted media generations",
  studio: "Story Studio multi-speaker audio projects; start with studio manual",
  "studio project": "Create, import, inspect and export projects",
  "studio chapter": "Add and rename chapters",
  "studio block": "Read, edit, polish and synthesize blocks",
  "studio take": "Generated audio history per block",
  "studio speaker": "Change a speaker's voice project-wide",
};

export const quickstart: QuickstartEntry[] = [
  { command: "account balance", summary: "Check credits and the TTS text budget" },
  { command: "voice search --language ko", summary: "Find a voice id" },
  { command: 'speech create --text "..." --voice-id <id>', summary: "Generate speech" },
  { command: "transcription create --audio-url <url>", summary: "Transcribe audio" },
  { command: "studio manual", summary: "Read before any studio command" },
];

export const skill = [
  "Discover progressively: fish-audio --help, then <noun> --help, then <noun> <verb> --help.",
  "Help and discovery never connect to the server; tool commands do.",
  "",
  "Workflows:",
  "  Speech: voice search -> speech create --voice-id <id>. Omit --voice-id to use a default voice for --language.",
  "  Transcription: upload audio for local files, PUT the bytes, then transcription create --audio-url <file_url>.",
  "  Voice clone: upload audio for each sample -> voice clone; follow its instructions field, which may ask for voice verify.",
  "  Media: account workspaces -> media model list/get -> media <kind> estimate -> media <kind> create -> media job status/result.",
  "  Studio: studio manual first. Run studio block generate --dry-run and studio project export without --confirmed-credits to get quotes.",
  "",
  "Cost rules:",
  "  Show the user a quote before any paid call: speech create, transcription create, media * create, studio block generate, studio project export.",
  "  Check account balance when a paid call may exceed the budget.",
  "",
  "Use --input or --input-file for nested or array arguments. Use call <tool> for exact MCP names.",
].join("\n");
