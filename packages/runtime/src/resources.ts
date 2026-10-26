import { formatText } from "./output";
import type {
  ResourceContent,
  ResourceDefinition,
  ResourceTemplateDefinition,
} from "@mcp-cli/core";
import {
  operands,
  rejectFlags,
  unknownSubcommand,
  withSession,
  type CatalogDependencies,
  type CatalogRequest,
} from "./catalog";

const RESOURCES = "resources";
const line = (key: string, item: ResourceDefinition | ResourceTemplateDefinition): string =>
  [key, item.title ?? item.name, item.mimeType, item.description]
    .filter((part) => part !== undefined && part !== "")
    .join("  ");
const contentText = (content: ResourceContent): string =>
  "text" in content
    ? formatText(content.text)
    : `[binary ${content.mimeType ?? "application/octet-stream"} ${content.uri}; use --json for base64]`;
const listText = (lines: string[], empty: string): string =>
  lines.length ? lines.join("\n") : empty;

export const runResources = async (
  request: CatalogRequest,
  dependencies: CatalogDependencies,
): Promise<number> => {
  const [subcommand] = request.path;
  rejectFlags(request, RESOURCES);
  const write = (value: unknown, text: string): void =>
    dependencies.io.write(request.json ? JSON.stringify(value, null, 2) : text);
  if (subcommand === "list") {
    operands(request, `${RESOURCES} list [--json]`, 0);
    const resources = await withSession(dependencies, (session) => session.listResources());
    write(
      resources,
      listText(
        resources.map((resource) => line(resource.uri, resource)),
        "No resources",
      ),
    );
    return 0;
  }
  if (subcommand === "templates") {
    operands(request, `${RESOURCES} templates [--json]`, 0);
    const templates = await withSession(dependencies, (session) => session.listResourceTemplates());
    write(
      templates,
      listText(
        templates.map((template) => line(template.uriTemplate, template)),
        "No resource templates",
      ),
    );
    return 0;
  }
  if (subcommand === "read") {
    const [uri = ""] = operands(request, `${RESOURCES} read <uri> [--json]`, 1);
    const contents = await withSession(dependencies, (session) => session.readResource(uri));
    write(contents, contents.map(contentText).join("\n"));
    return 0;
  }
  throw unknownSubcommand(request, RESOURCES);
};
