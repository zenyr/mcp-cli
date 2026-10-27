import { WorkspaceManager } from "./workspace-manager";
import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconDotsVertical, IconKey, IconLogout } from "@tabler/icons-react";
import { ServiceIcon } from "./service-icon";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAction, useServices } from "./queries";
import { workspaceRows, type Service } from "./ipc";
import { AuthSettingsPanel } from "./auth-settings-panel";

type Selection = { service: Service; credential: Service["credentials"][number] };
export const ServicesPage = () => {
  const { data, dataUpdatedAt, isPending, error } = useServices();
  const rows = workspaceRows(data);
  const [selection, setSelection] = useState<Selection>();
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const login = useAction("login", "인증을 저장했습니다.");
  const logout = useAction("logout", "저장된 인증을 삭제했습니다.");
  const cancel = useAction("cancelLogin");
  useEffect(
    () =>
      window.tiny?.api.on("open-url", (value) => {
        if (typeof value !== "string") return;
        const parsed = new URL(value);
        if (!["https:", "http:"].includes(parsed.protocol)) return;
        setUrl(value);
        void window.tiny?.app.shell.open(value).catch((failure: Error) =>
          notifications.show({
            title: "브라우저를 열지 못했습니다",
            message: failure.message,
            color: "red",
          }),
        );
      }),
    [],
  );
  const begin = (item: Selection) => {
    login.reset();
    setUrl("");
    setSecret("");
    setSelection(item);
    if (item.service.auth === "oauth")
      login.mutate(
        {
          service: item.service.name,
          workspace: item.service.workspace?.id,
          credential: item.credential.flag,
        },
        {
          onSuccess: (result) => {
            if (result === null) setSelection(undefined);
          },
        },
      );
  };
  const close = () => {
    if (login.isPending) cancel.mutate(undefined, { onSuccess: () => login.reset() });
    setSecret("");
    setUrl("");
    setSelection(undefined);
  };
  const remove = (item: Selection) =>
    modals.openConfirmModal({
      title: `${item.service.name}에서 로그아웃할까요?`,
      children: (
        <Text size="sm">
          저장된 인증을 삭제하고 열린 연결을 초기화합니다.
          {item.credential.fromEnv && " 환경 변수의 인증은 계속 사용됩니다."}
        </Text>
      ),
      labels: { confirm: "로그아웃", cancel: "취소" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        logout.mutate({
          service: item.service.name,
          workspace: item.service.workspace?.id,
          credential: item.credential.flag,
        }),
    });
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>서비스</Title>
        <Text size="xs" c="dimmed">
          사용할 서비스에 로그인해 주세요.
        </Text>
      </Group>
      {error && (
        <Alert color="red" title="서비스를 가져오지 못했습니다">
          {error.message}
        </Alert>
      )}
      {isPending && <Loader size="sm" />}
      {data && <WorkspaceManager services={data} />}
      {data && (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={480}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>서비스</Table.Th>
                  <Table.Th>워크스페이스</Table.Th>
                  <Table.Th>자격 증명</Table.Th>
                  <Table.Th>인증 상태</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.flatMap((service) =>
                  (service.credentials.length
                    ? service.credentials
                    : [{ flag: "", summary: "", stored: false, fromEnv: false }]
                  ).map((credential) => {
                    const item = { service, credential };
                    const state = service.error
                      ? "불러오기 실패"
                      : service.auth === "none"
                        ? "인증 없음"
                        : credential.fromEnv
                          ? "환경 변수 사용"
                          : credential.stored
                            ? "저장됨"
                            : "로그인 필요";
                    const color = service.error
                      ? "red"
                      : service.auth === "none"
                        ? "gray"
                        : credential.fromEnv
                          ? "violet"
                          : credential.stored
                            ? "teal"
                            : "orange";
                    return (
                      <Table.Tr
                        key={`${service.name}:${service.workspace?.id ?? "default"}:${credential.flag}`}
                      >
                        <Table.Td>
                          <Group wrap="nowrap" gap="sm">
                            <ServiceIcon service={service.name} credential={credential.flag} />
                            <Stack gap={2}>
                              <Text size="sm" fw={500}>
                                {service.name}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {service.error ?? service.summary}
                              </Text>
                            </Stack>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {service.workspace?.name ?? "default"}
                          {service.workspace?.id === service.defaultWorkspaceId && (
                            <Text size="xs" c="dimmed">
                              기본
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {credential.flag || (service.auth === "oauth" ? "OAuth" : "기본")}
                        </Table.Td>
                        <Table.Td>
                          <Badge color={color}>{state}</Badge>
                        </Table.Td>
                        <Table.Td>
                          {service.auth !== "none" && (
                            <Group justify="flex-end" gap={4} wrap="nowrap">
                              {credential.stored || credential.fromEnv ? (
                                <Menu position="bottom-end" withinPortal>
                                  <Menu.Target>
                                    <ActionIcon
                                      variant="subtle"
                                      color="gray"
                                      size="lg"
                                      aria-label={`${service.name} ${credential.flag || "기본"} 더보기`}
                                      disabled={
                                        login.isPending || cancel.isPending || logout.isPending
                                      }
                                    >
                                      <IconDotsVertical size={18} />
                                    </ActionIcon>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    <Menu.Item
                                      leftSection={<IconKey size={16} />}
                                      onClick={() => begin(item)}
                                    >
                                      {service.auth === "apiKey" ? "키 변경" : "다시 로그인"}
                                    </Menu.Item>
                                    {credential.stored && (
                                      <Menu.Item
                                        color="red"
                                        leftSection={<IconLogout size={16} />}
                                        onClick={() => remove(item)}
                                      >
                                        로그아웃
                                      </Menu.Item>
                                    )}
                                  </Menu.Dropdown>
                                </Menu>
                              ) : (
                                <Button
                                  variant="default"
                                  disabled={login.isPending || cancel.isPending || logout.isPending}
                                  onClick={() => begin(item)}
                                >
                                  {service.auth === "apiKey" ? "키 저장" : "로그인"}
                                </Button>
                              )}
                            </Group>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  }),
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      {rows
        .filter((service) => service.authentication)
        .map(
          (service) =>
            service.authentication && (
              <AuthSettingsPanel
                key={`${service.name}:${service.workspace?.id ?? "default"}:${dataUpdatedAt}`}
                service={service.name}
                workspace={service.workspace?.id}
                workspaceName={service.workspace?.name}
                authentication={service.authentication}
              />
            ),
        )}
      <Modal
        opened={Boolean(selection)}
        onClose={close}
        title={`${selection?.service.name ?? ""} / ${selection?.service.workspace?.name ?? "default"} ${selection?.service.auth === "apiKey" ? "API key 저장" : "로그인"}`}
        centered
      >
        <Stack gap="md">
          {selection?.credential.fromEnv && (
            <Alert color="violet">설정된 환경 변수가 저장된 인증보다 우선합니다.</Alert>
          )}
          {selection?.service.auth === "apiKey" ? (
            <>
              <PasswordInput
                label="API key"
                description="키는 이 기기의 인증 저장소에 저장합니다."
                value={secret}
                onChange={(event) => setSecret(event.currentTarget.value)}
                autoFocus
                autoComplete="off"
              />
              <Button
                loading={login.isPending}
                disabled={!secret.trim()}
                onClick={() => {
                  login.mutate(
                    {
                      service: selection.service.name,
                      workspace: selection.service.workspace?.id,
                      credential: selection.credential.flag,
                      secret,
                    },
                    {
                      onSuccess: () => {
                        setSecret("");
                        setSelection(undefined);
                      },
                    },
                  );
                }}
              >
                저장
              </Button>
            </>
          ) : (
            <>
              <Group>
                {login.isPending && <Loader size="sm" />}
                <Text size="sm">
                  {login.isPending
                    ? "브라우저에서 로그인을 완료해 주세요."
                    : "로그인 요청이 종료되었습니다."}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                로그인은 5분 뒤 만료됩니다. 취소하면 로그인 요청을 종료합니다.
              </Text>
              {url && (
                <Group>
                  <Button
                    variant="default"
                    onClick={() => {
                      void window.tiny?.app.shell.open(url);
                    }}
                  >
                    브라우저 다시 열기
                  </Button>
                  <Button
                    variant="subtle"
                    onClick={() => {
                      void window.tiny?.clipboard.write({ text: url });
                    }}
                  >
                    로그인 URL 복사
                  </Button>
                </Group>
              )}
              <Button variant="default" onClick={close}>
                취소
              </Button>
            </>
          )}
          {login.error && <Alert color="red">{login.error.message}</Alert>}
        </Stack>
      </Modal>
    </Stack>
  );
};
