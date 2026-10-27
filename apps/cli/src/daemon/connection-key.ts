import { createHash } from "node:crypto";
import { canonicalize, type Connection } from "@mcp-cli/core";
import type { DiscoveredPlugin } from "../discovery";
import type { SessionRequest } from "./protocol";

export const connectionKey = (
  request: SessionRequest,
  config: Connection,
  identity: string,
  plugin: DiscoveredPlugin,
) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          service: request.service,
          workspace: request.workspace,
          identity,
          plugin,
          config: { ...config, authorize: undefined },
          ...(config.type === "stdio" && { cwd: request.cwd, env: request.env }),
        }),
      ),
    )
    .digest("hex");
