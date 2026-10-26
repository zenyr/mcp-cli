import { createHash } from "node:crypto";
import { AuthRequiredError, isRecord, UsageError, type AuthSupportContext } from "@mcp-cli/core";
import { readSlackSettings } from "./auth-config";
import type { SlackDetection, SlackProfile, SlackTarget } from "./auth-types";

const keyFor = (appId: string) =>
  `slack-inspector-${createHash("sha256").update(appId).digest("hex")}`;
const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
export const detectedSettings = async (
  context: AuthSupportContext,
  appId: string,
): Promise<SlackDetection> => {
  const value = await context.settings.read(keyFor(appId));
  if (!value || value.appId !== appId) return { appId, available: false };
  return {
    appId,
    available: value.available === true,
    checkedAt: typeof value.checkedAt === "number" ? value.checkedAt : undefined,
    pkce: bool(value.pkce),
    rotation: bool(value.rotation),
    mcp: bool(value.mcp),
    redirectUris: strings(value.redirectUris),
    scopes: strings(value.scopes),
  };
};

export const inspectSlackApp = async (
  context: AuthSupportContext,
  target: SlackTarget,
  input: { secret?: string; forget?: boolean } = {},
  request: typeof fetch = fetch,
): Promise<SlackDetection> => {
  const { configuration } = await readSlackSettings(context);
  const appId = configuration[target].appId;
  if (!appId || !/^A[A-Z0-9]+$/.test(appId))
    throw new UsageError("Enter the Slack App ID before detecting settings.");
  const key = keyFor(appId);
  return context.store.withLock(key, async () => {
    if (input.forget) {
      await context.store.delete(key);
      await context.settings.write(key, { appId, available: false });
      return { appId, available: false };
    }
    const secret = input.secret?.trim() || (await context.store.read(key))?.accessToken;
    if (!secret)
      throw new AuthRequiredError(
        "Automatic detection needs an App configuration token with app_configurations:read. Ordinary user and bot tokens cannot inspect App settings.",
      );
    try {
      const response = await request("https://slack.com/api/apps.manifest.export", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ app_id: appId }),
      });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || data.ok !== true || !isRecord(data.manifest))
        throw new Error("Manifest export rejected");
      const oauth = isRecord(data.manifest.oauth_config) ? data.manifest.oauth_config : {};
      const settings = isRecord(data.manifest.settings) ? data.manifest.settings : {};
      const scopes = isRecord(oauth.scopes) ? strings(oauth.scopes.user) : undefined;
      const detection: SlackDetection = {
        appId,
        available: true,
        checkedAt: Date.now(),
        pkce: bool(oauth.pkce_enabled),
        rotation: bool(settings.token_rotation_enabled),
        mcp: bool(settings.is_mcp_enabled),
        redirectUris: strings(oauth.redirect_urls),
        scopes,
      };
      await context.settings.write(key, { ...detection });
      if (input.secret) await context.store.write(key, { accessToken: secret });
      return detection;
    } catch {
      await context.settings.write(key, { appId, available: false, checkedAt: Date.now() });
      throw new AuthRequiredError(
        "Could not read Slack App settings. Check the configuration token, app ownership, app_configurations:read permission, and network. No authentication fallback was performed.",
      );
    }
  });
};

export const effectiveProfile = async (
  context: AuthSupportContext,
  config: SlackProfile,
  target: SlackTarget,
): Promise<SlackProfile> => {
  if (config.method !== "auto") return config;
  const detection = await detectedSettings(context, config.appId ?? "");
  if (!detection.available || detection.pkce === undefined)
    throw new AuthRequiredError(
      "Slack PKCE support is unknown. Detect App settings first, or explicitly choose token input or manually confirmed browser login.",
    );
  if (!detection.pkce) return { ...config, method: "token", pkceEnabled: false };
  if (!config.redirectUri || !detection.redirectUris?.includes(config.redirectUri))
    throw new AuthRequiredError(
      "The selected redirect URL is not in the detected Slack App settings.",
    );
  if (!config.scopes?.length || config.scopes.some((scope) => !detection.scopes?.includes(scope)))
    throw new AuthRequiredError(
      "Select user scopes that exist in the detected Slack App settings.",
    );
  if (target === "mcp" && detection.mcp !== true)
    throw new AuthRequiredError("MCP access is not confirmed by the detected Slack App settings.");
  return { ...config, method: "pkce", pkceEnabled: true, mcpEnabled: detection.mcp };
};
