import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { call } from "./ipc";
import { useAction, useStatus } from "./queries";

export const SettingsPage = () => {
  const client = useQueryClient();
  const { data: settings, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => call("settings"),
  });
  const autostart = useQuery({
    queryKey: ["autostart"],
    queryFn: () => window.tiny?.app.launchAtLogin.get() ?? "unsupported",
  });
  const { data } = useStatus();
  const [command, setCommand] = useState<string>();
  const save = useAction("saveSettings", "설정을 저장했습니다.");
  const persist = async (autoStart = settings?.autoStart ?? false) => {
    await save.mutateAsync({
      cliCommand: (command ?? settings?.cliCommand.join("\n") ?? "mcp-cli")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      autoStart,
    });
    await client.invalidateQueries({ queryKey: ["settings"] });
  };
  return (
    <Stack gap="lg">
      <Title order={3}>설정</Title>
      {error && <Alert color="red">{error.message}</Alert>}
      <Paper withBorder p="lg">
        <Stack gap="lg">
          <Switch
            label="로그인할 때 앱 실행"
            description={
              autostart.data === "unsupported"
                ? "개발 모드에서는 지원하지 않습니다."
                : "앱은 트레이에서 시작합니다."
            }
            checked={autostart.data === "enabled"}
            disabled={!autostart.data || autostart.data === "unsupported"}
            onChange={async (event) => {
              try {
                const state = await window.tiny?.app.launchAtLogin.set(event.currentTarget.checked);
                if (state === "requires-approval")
                  notifications.show({
                    message: "시스템 설정에서 로그인 항목을 허용해 주세요.",
                    color: "yellow",
                  });
                await client.invalidateQueries({ queryKey: ["autostart"] });
              } catch (failure) {
                notifications.show({
                  message: failure instanceof Error ? failure.message : String(failure),
                  color: "red",
                });
              }
            }}
          />
          <Switch
            label="앱을 시작할 때 대몬 시작"
            description="앱을 종료해도 대몬은 계속 실행합니다."
            checked={settings?.autoStart ?? false}
            disabled={!settings || save.isPending}
            onChange={(event) => {
              void persist(event.currentTarget.checked).catch(() => undefined);
            }}
          />
          <Divider />
          <Textarea
            label="CLI 실행 명령"
            description="실행 파일과 인수를 줄마다 하나씩 입력해 주세요. 개발 환경에서는 bun 경로와 main.ts 경로를 입력합니다."
            autosize
            minRows={2}
            value={command ?? settings?.cliCommand.join("\n") ?? ""}
            onChange={(event) => setCommand(event.currentTarget.value)}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12 } }}
          />
          <Group justify="flex-end">
            <Button
              loading={save.isPending}
              onClick={() => {
                void persist().catch(() => undefined);
              }}
            >
              저장
            </Button>
          </Group>
        </Stack>
      </Paper>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          앱 버전 <Code>0.1.0</Code>
        </Text>
        <Text size="xs" c="dimmed">
          유휴 종료 <Code>60초</Code>
        </Text>
        {data?.online && (
          <Text size="xs" c="dimmed">
            IPC <Code className="socket-path">{data.status.address}</Code>
          </Text>
        )}
      </Stack>
    </Stack>
  );
};
