import { t } from "./i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { playUiSound } from "./ui-sounds";
import { call, type Api } from "./ipc";

export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: () => call("status"),
    refetchInterval: 2000,
    staleTime: 1000,
    retry: false,
  });
export const useServices = () =>
  useQuery({
    queryKey: ["services"],
    queryFn: () => call("services"),
    staleTime: 30_000,
    retry: false,
  });
export const usePlugins = () =>
  useQuery({
    queryKey: ["plugins"],
    queryFn: () => call("plugins"),
    staleTime: 10_000,
    retry: false,
  });
export const useCommands = (service: string, enabled: boolean, live = false) =>
  useQuery({
    queryKey: ["commands", service, live ? "live" : "bundled"],
    queryFn: () => call("commands", { service, live }),
    enabled,
    staleTime: live ? 300_000 : 60_000,
    retry: false,
  });
const feedbackActions = new Set<keyof Api>([
  "start",
  "stop",
  "reset",
  "login",
  "logout",
  "authConfig",
  "saveSettings",
  "pluginAction",
  "workspaceAction",
]);

export const useAction = <K extends keyof Api>(method: K, message?: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Api[K]["input"]) => call(method, input),
    onSuccess: async (result) => {
      if (method === "authStatus") return;
      if (method === "login" && result !== null) return;
      if (feedbackActions.has(method) && method !== "start") playUiSound("success");
      if (message) notifications.show({ message, color: "teal" });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["status"] }),
        client.invalidateQueries({ queryKey: ["services"] }),
        client.invalidateQueries({ queryKey: ["plugins"] }),
        ...(method === "pluginAction"
          ? [client.invalidateQueries({ queryKey: ["commands"] })]
          : []),
      ]);
    },
    onError: (error) => {
      if (feedbackActions.has(method)) playUiSound("error");
      notifications.show({
        title: t("작업을 완료하지 못했습니다"),
        message: error.message,
        color: "red",
        autoClose: 6000,
      });
    },
  });
};
