import { t, useLocale } from "./i18n";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accordion,
  Alert,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { SoundSettings } from "./sound-settings";
import { useSettings } from "./ui-sounds";
import { useAction, useStatus } from "./queries";

export const SettingsPage = () => {
  useLocale();
  const client = useQueryClient();
  const { data: settings, error } = useSettings();
  const autostart = useQuery({
    queryKey: ["autostart"],
    queryFn: () => window.tiny?.app.launchAtLogin.get() ?? "unsupported",
  });
  const { data } = useStatus();
  const [command, setCommand] = useState<string>();
  const save = useAction("saveSettings", t("설정을 저장했습니다."));
  const persist = async (autoStart = settings?.autoStart ?? false) => {
    await save.mutateAsync({
      ...(command !== undefined && {
        cliCommand: command
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }),
      autoStart,
    });
    await client.invalidateQueries({ queryKey: ["settings"] });
  };
  return (
    <Stack gap="lg">
      <Title order={3}>{t("설정")}</Title>
      {error && <Alert color="red">{error.message}</Alert>}
      <Paper withBorder p="lg">
        <Stack gap="lg">
          <Switch
            label={t("로그인할 때 앱 실행")}
            description={
              autostart.data === "unsupported"
                ? t("개발 모드에서는 지원하지 않습니다.")
                : t("앱은 트레이에서 시작합니다.")
            }
            checked={autostart.data === "enabled"}
            disabled={!autostart.data || autostart.data === "unsupported"}
            onChange={async (event) => {
              try {
                const state = await window.tiny?.app.launchAtLogin.set(event.currentTarget.checked);
                if (state === "requires-approval")
                  notifications.show({
                    message: t("시스템 설정에서 로그인 항목을 허용해 주세요."),
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
            label={t("앱을 시작할 때 연결 준비")}
            description={t("앱을 종료해도 백그라운드에서 실행합니다.")}
            checked={settings?.autoStart ?? false}
            disabled={!settings || save.isPending}
            onChange={(event) => {
              void persist(event.currentTarget.checked).catch(() => undefined);
            }}
          />
          <Accordion variant="contained">
            <Accordion.Item value="advanced">
              <Accordion.Control>{t("고급 설정")}</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="md">
                  <Textarea
                    label={t("CLI 실행 명령")}
                    description={t(
                      "별도 CLI를 사용할 때만 변경해 주세요. 실행 파일과 인수를 줄마다 하나씩 입력합니다.",
                    )}
                    autosize
                    minRows={2}
                    value={command ?? settings?.cliCommand.join("\n") ?? ""}
                    onChange={(event) => setCommand(event.currentTarget.value)}
                    styles={{
                      input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12 },
                    }}
                  />
                  <Group justify="flex-end">
                    <Button
                      variant="default"
                      disabled={!settings || save.isPending}
                      onClick={async () => {
                        try {
                          await save.mutateAsync({
                            cliCommand: null,
                            autoStart: settings?.autoStart ?? false,
                          });
                          setCommand(undefined);
                          await client.invalidateQueries({ queryKey: ["settings"] });
                        } catch {
                          /* The mutation displays the error. */
                        }
                      }}
                    >
                      {t("기본 명령 사용")}
                    </Button>
                    <Button
                      loading={save.isPending}
                      onClick={() => {
                        void persist().catch(() => undefined);
                      }}
                    >
                      {t("저장")}
                    </Button>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {t("유휴 종료")} <Code>{t("60초")}</Code>
                  </Text>
                  {data?.online && (
                    <Text size="xs" c="dimmed">
                      IPC <Code className="socket-path">{data.status.address}</Code>
                    </Text>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Paper>
      <SoundSettings />
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          {t("앱 버전")} <Code>0.1.0</Code>
        </Text>
      </Stack>
    </Stack>
  );
};
