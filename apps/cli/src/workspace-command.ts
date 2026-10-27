import { UsageError, type WorkspaceAction } from "@mcp-cli/core";
import { formatOutput } from "@mcp-cli/runtime";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { readWorkspaces, updateWorkspace } from "./workspaces";

const usage =
  "Usage: mcp-cli workspaces <list SERVICE|add SERVICE NAME|rename SERVICE WORKSPACE NAME|default SERVICE WORKSPACE> [--json]";
export const workspaceCommand = async (argv: string[]) => {
  const json = argv.includes("--json");
  const [action, service, workspace, name, ...rest] = argv.filter((arg) => arg !== "--json");
  if (!service || rest.length) throw new UsageError(usage);
  const registry = await discover(await defaultContext());
  const plugin = await loadPlugin(findPlugin(registry, service), registry.context);
  if (action === "list" && !workspace && !name) {
    console.log(formatOutput(await readWorkspaces(plugin), json));
    return;
  }
  let request: WorkspaceAction;
  if (action === "add" && workspace && !name) request = { type: "add", service, name: workspace };
  else if (action === "default" && workspace && !name)
    request = { type: "default", service, workspace };
  else if (action === "rename" && workspace && name)
    request = { type: "rename", service, workspace, name };
  else throw new UsageError(usage);
  console.log(formatOutput(await updateWorkspace(plugin, request), json));
};
