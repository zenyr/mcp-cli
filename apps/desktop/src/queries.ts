import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
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
export const useAction = <K extends keyof Api>(method: K, message?: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Api[K]["input"]) => call(method, input),
    onSuccess: async () => {
      if (message) notifications.show({ message, color: "teal" });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["status"] }),
        client.invalidateQueries({ queryKey: ["services"] }),
      ]);
    },
    onError: (error) =>
      notifications.show({
        title: "작업을 완료하지 못했습니다",
        message: error.message,
        color: "red",
        autoClose: 6000,
      }),
  });
};
