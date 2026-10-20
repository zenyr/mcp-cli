import { Paper, Switch } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { call, type Settings } from "./ipc";
import { useSettings } from "./ui-sounds";

export const SoundSettings = () => {
  const client = useQueryClient();
  const { data } = useSettings();
  const enabled = data?.soundsEnabled ?? true;
  const save = useMutation({
    mutationFn: (value: boolean) => call("setSoundsEnabled", { enabled: value }),
    onMutate: async (value) => {
      await client.cancelQueries({ queryKey: ["settings"] });
      const previous = client.getQueryData<Settings>(["settings"]);
      if (previous) client.setQueryData(["settings"], { ...previous, soundsEnabled: value });
      return previous;
    },
    onError: (error, _value, previous) => {
      if (previous) client.setQueryData(["settings"], previous);
      notifications.show({
        title: "효과음 설정을 저장하지 못했습니다",
        message: error.message,
        color: "red",
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  return (
    <Paper withBorder p="lg" data-sfx="off">
      <Switch
        label="효과음"
        description="대몬 시작, 작업 결과, 버튼 조작에 소리를 냅니다."
        checked={enabled}
        disabled={!data || save.isPending}
        onChange={(event) => save.mutate(event.currentTarget.checked)}
      />
    </Paper>
  );
};
