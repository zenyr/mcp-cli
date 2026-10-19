import type { CommandCustomization } from "@mcp-cli/core";

const at = (
  path: string,
  summary: string,
  examples: string[],
  rules: string[] = [],
): CommandCustomization => ({ path: path.split(" "), summary, examples, rules });

export const assetCommands: Record<string, CommandCustomization> = {
  list_assets: at(
    "asset list",
    "List files in a collection or search the workspace",
    [
      "fish-audio asset list --workspace-id <workspace-id> --collection-id <collection-id>",
      "fish-audio asset list --workspace-id <workspace-id> --search portrait --kinds '[\"image\"]'",
    ],
    [
      "Follow next_cursor with --cursor and keep the same filters; omit collection-id for workspace search.",
    ],
  ),
  get_asset: at(
    "asset get",
    "Get an asset's original object key and temporary download URL",
    ["fish-audio asset get --workspace-id <workspace-id> --asset-id <asset-id>"],
    ["Use object_key for compatible generation inputs; thumbnail_url is only a preview."],
  ),
  save_asset: at(
    "asset save",
    "Retain a completed upload or successful generation result",
    [
      "fish-audio asset save --workspace-id <workspace-id> --source-task-id <task-id> --title Portrait",
      "fish-audio asset save --workspace-id <workspace-id> --object-key <object-key> --file-name portrait.png",
    ],
    [
      "Supply a completed upload's object_key or a successful task's source_task_id.",
      "Saving again returns its existing location; use asset update to move it.",
    ],
  ),
  update_asset: at(
    "asset update",
    "Rename an asset or move it between collections",
    [
      "fish-audio asset update --workspace-id <workspace-id> --asset-id <asset-id> --collection-id <collection-id>",
      'fish-audio asset update --input \'{"workspace_id":"<workspace-id>","asset_id":"<asset-id>","collection_id":null}\'',
    ],
    [
      "Omit collection-id to keep the location; use --input with JSON null to move to the root.",
      "For an avatar reference image, move the asset into the avatar's collection.",
    ],
  ),
  list_asset_collections: at(
    "asset collection list",
    "List folders, avatars and styles, separately from files",
    [
      "fish-audio asset collection list --workspace-id <workspace-id> --all",
      "fish-audio asset collection list --workspace-id <workspace-id> --kind avatar",
    ],
    [
      "The default lists direct children; --all returns a flat tree.",
      "Use asset list for files inside a collection.",
    ],
  ),
  get_asset_collection: at(
    "asset collection get",
    "Read folder placement or an avatar's portrait and voice",
    [
      "fish-audio asset collection get --workspace-id <workspace-id> --collection-id <collection-id>",
    ],
  ),
  update_asset_collection: at(
    "asset collection update",
    "Rename or move a folder, or edit an avatar's portrait and voice",
    [
      "fish-audio asset collection update --workspace-id <workspace-id> --collection-id <collection-id> --name References",
    ],
    [
      "An avatar portrait must already belong to that avatar's collection; move it with asset update first.",
      "This command does not delete collections or create styles.",
    ],
  ),
  create_asset_folder: at(
    "asset folder create",
    "Create a nested folder with a reusable request UUID",
    [
      "fish-audio asset folder create --workspace-id <workspace-id> --name References --request-id <request-uuid>",
    ],
    ["Reuse the same UUID request-id and identical arguments to recover a lost response."],
  ),
  create_avatar: at(
    "asset avatar create",
    "Create an avatar from one prepared image, optionally with a voice",
    [
      "fish-audio asset avatar create --workspace-id <workspace-id> --name Presenter --object-key <object-key> --request-id <request-uuid>",
    ],
    [
      "Choose one image source: object_key, source_task_id or portrait_asset_id; this does not generate media.",
      "A retained image requires explicit approval before --move-existing relocates it.",
      "Reuse the same UUID request-id and identical arguments to recover a lost response.",
    ],
  ),
};
