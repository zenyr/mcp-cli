import { ActionIcon, Divider, Group, Paper, Stack, Switch, Text } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { soundDescriptions, type SoundKind } from "../shared/ui-sounds";
import { call, type Settings } from "./ipc";
import { playUiSound, useSettings } from "./ui-sounds";

const order: SoundKind[] = ["start", "success", "error", "click", "hover"];
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
      <Stack gap="md">
        <Switch
          label="효과음"
          description="대몬 시작, 작업 결과, 버튼 조작에 소리를 냅니다."
          checked={enabled}
          disabled={!data || save.isPending}
          onChange={(event) => save.mutate(event.currentTarget.checked)}
        />
        <Divider />
        <Stack gap={6}>
          {order.map((kind) => {
            const sound = soundDescriptions[kind];
            return (
              <Group key={kind} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" w={36}>
                    {sound.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {sound.description}
                  </Text>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    {sound.name}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label={`${sound.title}음 듣기`}
                    disabled={!data || !enabled || save.isPending}
                    onClick={() => playUiSound(kind)}
                  >
                    <IconPlayerPlay size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
};
