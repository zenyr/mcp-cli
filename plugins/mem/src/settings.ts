import { UsageError, type AuthSupport } from "@mcp-cli/core";
import { decodeSettings } from "@mcp-cli/mem/settings";

const configuration = async (context: Parameters<AuthSupport["configuration"]>[0]) => {
  const stored = await context.settings.read("mem");
  const settings = decodeSettings(stored?.configuration ?? {});
  return {
    model: settings.model,
    baseUrl: settings.baseUrl,
    thinking: settings.thinking ?? "default",
  };
};

export const memAuthSupport: AuthSupport = {
  fields: [
    { path: ["model"], label: "Summary model", type: "text" },
    {
      path: ["baseUrl"],
      label: "API base URL",
      description: "OpenAI-compatible endpoint, including /v1. MEM_BASE_URL takes precedence.",
      type: "text",
    },
    {
      path: ["thinking"],
      label: "Reasoning",
      type: "select",
      options: [
        { value: "default", label: "Provider default" },
        { value: "enabled", label: "Enabled" },
        { value: "disabled", label: "Disabled" },
      ],
    },
  ],
  configuration,
  configure: async (context, value) => {
    const settings = decodeSettings(value);
    await context.settings.withLock("mem", () =>
      context.settings.write("mem", {
        configuration: {
          model: settings.model,
          baseUrl: settings.baseUrl,
          thinking: settings.thinking ?? "default",
        },
      }),
    );
  },
  status: async () => [],
  login: async () => {
    throw new UsageError("Mem uses a configured summary endpoint, without browser login.");
  },
  logout: async () => {
    throw new UsageError("Clear the Mem plugin settings to remove its summary endpoint.");
  },
  resolve: async () => undefined,
  identity: async () => ({ service: "mem" }),
};
