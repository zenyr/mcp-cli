import { t, useLocale } from "./i18n";
import { useState } from "react";
import { Alert, Button, Group, Modal, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import type { Service } from "./ipc";
import { useAction } from "./queries";

export const WorkspaceManager = ({ services }: { services: Service[] }) => {
  useLocale();
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"add" | "rename">();
  const [name, setName] = useState("");
  const action = useAction("workspaceAction", t("워크스페이스 설정을 저장했습니다."));
  const available = services.filter((service) => service.supportsWorkspaces);
  const service = available.find((item) => item.name === serviceName) ?? available[0];
  if (!service) return null;
  const workspaces = service.workspaces ?? [];
  const current =
    workspaces.find((item) => item.workspace?.id === selected)?.workspace ??
    workspaces[0]?.workspace;
  const close = () => {
    setMode(undefined);
    setName("");
  };
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Text fw={500}>{t("워크스페이스 관리")}</Text>
        <Group align="flex-end">
          <Select
            label={t("서비스")}
            value={service.name}
            data={available.map((item) => item.name)}
            onChange={(value) => {
              setServiceName(value);
              setSelected(null);
            }}
          />
          <Select
            label={t("워크스페이스")}
            value={current?.id ?? null}
            data={workspaces.flatMap((item) =>
              item.workspace
                ? [
                    {
                      value: item.workspace.id,
                      label: `${item.workspace.name}${item.workspace.id === service.defaultWorkspaceId ? t(" (기본)") : ""}`,
                    },
                  ]
                : [],
            )}
            onChange={setSelected}
          />
          <Button
            variant="default"
            disabled={action.isPending}
            onClick={() => {
              setName("");
              setMode("add");
            }}
          >
            {t("추가")}
          </Button>
          <Button
            variant="subtle"
            disabled={!current || action.isPending}
            onClick={() => {
              setName(current?.name ?? "");
              setMode("rename");
            }}
          >
            {t("이름 변경")}
          </Button>
          <Button
            variant="subtle"
            disabled={!current || current.id === service.defaultWorkspaceId || action.isPending}
            onClick={() => {
              if (current)
                action.mutate({ type: "default", service: service.name, workspace: current.id });
            }}
          >
            {t("기본으로 사용")}
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          {t("추가한 워크스페이스는 아래 목록에서 로그인하세요. CLI에서는 -w 이름으로 선택합니다.")}
        </Text>
        <Modal
          opened={mode !== undefined}
          onClose={close}
          title={mode === "add" ? t("워크스페이스 추가") : t("워크스페이스 이름 변경")}
          centered
        >
          <Stack>
            <TextInput
              label={t("이름")}
              description={t("영문 소문자로 시작하며 숫자와 하이픈을 사용할 수 있습니다.")}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              autoFocus
            />
            {action.error && <Alert color="red">{action.error.message}</Alert>}
            <Button
              loading={action.isPending}
              disabled={!/^[a-z][a-z0-9-]{0,63}$/.test(name)}
              onClick={() => {
                if (mode === "add")
                  action.mutate({ type: "add", service: service.name, name }, { onSuccess: close });
                else if (current)
                  action.mutate(
                    { type: "rename", service: service.name, workspace: current.id, name },
                    { onSuccess: close },
                  );
              }}
            >
              {t("저장")}
            </Button>
          </Stack>
        </Modal>
      </Stack>
    </Paper>
  );
};
