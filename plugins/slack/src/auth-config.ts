import { createHash } from "node:crypto";
import { isRecord, UsageError, type AuthSupportContext } from "@mcp-cli/core";

import type { SlackConfiguration, SlackProfile, SlackTarget } from "./auth-types";
export type { SlackConfiguration, SlackProfile, SlackTarget } from "./auth-types";
const fields = [
  "method",
  "clientId",
  "appId",
  "teamId",
  "redirectUri",
  "scopes",
  "pkceEnabled",
  "mcpEnabled",
  "distribution",
];
const profile = (value: unknown): SlackProfile => {
  if (value === undefined) return { method: "token" };
  if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key)))
    throw new UsageError(
      "Slack settings contain unsupported fields. Never put secrets in settings.",
    );
  if (value.method !== "token" && value.method !== "pkce")
    throw new UsageError("Choose token or pkce authentication.");
  const result: SlackProfile = { method: value.method };
  for (const key of ["clientId", "appId", "teamId", "redirectUri"] as const) {
    const text = value[key];
    if (text !== undefined && (typeof text !== "string" || !text.trim()))
      throw new UsageError(`Slack ${key} must be non-empty text.`);
    if (typeof text === "string") result[key] = text.trim();
  }
  for (const key of ["pkceEnabled", "mcpEnabled"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      throw new UsageError(`Slack ${key} must be true or false.`);
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  if (value.distribution !== undefined) {
    if (
      value.distribution !== "internal" &&
      value.distribution !== "marketplace" &&
      value.distribution !== "unlisted"
    )
      throw new UsageError("Select the Slack app distribution type.");
    result.distribution = value.distribution;
  }
  if (value.scopes !== undefined) {
    if (
      !Array.isArray(value.scopes) ||
      value.scopes.some((scope) => typeof scope !== "string" || !/^[a-z][a-z0-9_.:-]*$/.test(scope))
    )
      throw new UsageError("Slack scopes must be a list of scope names.");
    result.scopes = [...new Set(value.scopes as string[])].sort();
  }
  return result;
};
export const decodeSlackConfiguration = (value: unknown): SlackConfiguration => {
  if (!isRecord(value) || Object.keys(value).some((key) => !["mcp", "web"].includes(key)))
    throw new UsageError("Slack settings require mcp and web profiles only.");
  return { mcp: profile(value.mcp), web: profile(value.web) };
};
export const readSlackSettings = async (context: AuthSupportContext) => {
  const saved = await context.settings.read("slack");
  return {
    configuration: decodeSlackConfiguration(saved?.configuration ?? {}),
    revision: saved?.revision,
  };
};
export const slackFingerprint = (
  configuration: SlackProfile,
  revision: unknown,
  target: SlackTarget,
) => createHash("sha256").update(JSON.stringify({ configuration, revision, target })).digest("hex");
export const slackSlot = (target: SlackTarget) => `slack-oauth-${target}`;
export const slackTarget = (target: string | undefined): SlackTarget => {
  if (target !== "mcp" && target !== "web")
    throw new UsageError("Choose --mcp or --web for Slack browser login.");
  return target;
};
export const readiness = (config: SlackProfile, target: SlackTarget): string | undefined => {
  if (config.method !== "pkce") return "Choose browser login in this target's settings first.";
  if (!config.clientId || !/^\d+\.\d+$/.test(config.clientId))
    return "Enter the Client ID from Slack Basic Information.";
  if (!config.appId || !/^A[A-Z0-9]+$/.test(config.appId))
    return "Enter the App ID from Slack Basic Information.";
  if (!config.teamId || !/^T[A-Z0-9]+$/.test(config.teamId))
    return "Enter the workspace ID to prevent signing into another workspace.";
  if (config.pkceEnabled !== true)
    return "Confirm PKCE is enabled in Slack OAuth & Permissions. Enabling it is a one-way change.";
  if (!config.scopes?.length) return "Enter the user scopes enabled for this Slack app.";
  if (config.scopes.some((scope) => ["openid", "email", "profile"].includes(scope)))
    return "Sign in with Slack scopes cannot be mixed with API scopes.";
  if (
    target === "mcp" &&
    (config.mcpEnabled !== true || !["internal", "marketplace"].includes(config.distribution ?? ""))
  )
    return "Confirm MCP access is enabled and the app is internal or Marketplace-published.";
  try {
    const url = new URL(config.redirectUri ?? "");
    if (
      url.protocol !== "http:" ||
      url.hostname !== "localhost" ||
      !url.port ||
      Number(url.port) < 1024 ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "Register an exact http://localhost:PORT/path redirect URL with a port from 1024 to 65535.";
  } catch {
    return "Enter the exact localhost redirect URL registered in Slack OAuth & Permissions.";
  }
  return undefined;
};
