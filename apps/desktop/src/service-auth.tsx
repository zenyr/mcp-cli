import { t, useLocale } from "./i18n";
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
} from "@mantine/core";
import { IconDotsVertical, IconKey, IconLogout } from "@tabler/icons-react";
import { ServiceIcon } from "./service-icon";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAction } from "./queries";
import { workspaceRows, type Service } from "./ipc";
import { AuthSettingsPanel } from "./auth-settings-panel";

type Selection = { service: Service; credential: Service["credentials"][number] };
export const ServiceAuth = ({ service: target }: { service: Service }) => {
  useLocale();
  const rows = workspaceRows([target]);
  const [selection, setSelection] = useState<Selection>();
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const login = useAction("login", t("인증을 저장했습니다."));
  const logout = useAction("logout", t("저장된 인증을 삭제했습니다."));
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
            title: t("브라우저를 열지 못했습니다"),
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
      title: t("{service}에서 로그아웃할까요?", { service: item.service.name }),
      children: (
        <Text size="sm">
          {t("저장된 인증을 삭제하고 열린 연결을 초기화합니다.")}
          {item.credential.fromEnv && t(" 환경 변수의 인증은 계속 사용됩니다.")}
        </Text>
      ),
      labels: { confirm: t("로그아웃"), cancel: t("취소") },
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
      {target.supportsWorkspaces && <WorkspaceManager services={[target]} />}
      {target.auth === "none" && !target.error ? (
        <Alert color="gray">{t("이 플러그인은 인증이 필요하지 않습니다.")}</Alert>
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={480}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("자격 증명")}</Table.Th>
                  <Table.Th>{t("워크스페이스")}</Table.Th>
                  <Table.Th>{t("인증 상태")}</Table.Th>
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
                      ? t("불러오기 실패")
                      : service.auth === "none"
                        ? t("인증 없음")
                        : credential.fromEnv
                          ? t("환경 변수 사용")
                          : credential.stored
                            ? t("저장됨")
                            : t("로그인 필요");
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
                                {credential.flag ||
                                  (service.auth === "oauth" ? "OAuth" : t("기본"))}
                              </Text>
                              {service.error && (
                                <Text size="xs" c="dimmed">
                                  {service.error}
                                </Text>
                              )}
                            </Stack>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {service.workspace?.name ?? "default"}
                          {service.workspace?.id === service.defaultWorkspaceId && (
                            <Text size="xs" c="dimmed">
                              {t("기본")}
                            </Text>
                          )}
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
                                      aria-label={t("{name} 더보기", {
                                        name: `${service.name} ${credential.flag || t("기본")}`,
                                      })}
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
                                      {service.auth === "apiKey" ? t("키 변경") : t("다시 로그인")}
                                    </Menu.Item>
                                    {credential.stored && (
                                      <Menu.Item
                                        color="red"
                                        leftSection={<IconLogout size={16} />}
                                        onClick={() => remove(item)}
                                      >
                                        {t("로그아웃")}
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
                                  {service.auth === "apiKey" ? t("키 저장") : t("로그인")}
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
                key={`${service.name}:${service.workspace?.id ?? "default"}`}
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
        title={`${selection?.service.name ?? ""} / ${selection?.service.workspace?.name ?? "default"} ${selection?.service.auth === "apiKey" ? t("API key 저장") : t("로그인")}`}
        centered
      >
        <Stack gap="md">
          {selection?.credential.fromEnv && (
            <Alert color="violet">{t("설정된 환경 변수가 저장된 인증보다 우선합니다.")}</Alert>
          )}
          {selection?.service.auth === "apiKey" ? (
            <>
              <PasswordInput
                label="API key"
                description={t("키는 이 기기의 인증 저장소에 저장합니다.")}
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
                {t("저장")}
              </Button>
            </>
          ) : (
            <>
              <Group>
                {login.isPending && <Loader size="sm" />}
                <Text size="sm">
                  {login.isPending
                    ? t("브라우저에서 로그인을 완료해 주세요.")
                    : t("로그인 요청이 종료되었습니다.")}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("로그인은 5분 뒤 만료됩니다. 취소하면 로그인 요청을 종료합니다.")}
              </Text>
              {url && (
                <Group>
                  <Button
                    variant="default"
                    onClick={() => {
                      void window.tiny?.app.shell.open(url);
                    }}
                  >
                    {t("브라우저 다시 열기")}
                  </Button>
                  <Button
                    variant="subtle"
                    onClick={() => {
                      void window.tiny?.clipboard.write({ text: url });
                    }}
                  >
                    {t("로그인 URL 복사")}
                  </Button>
                </Group>
              )}
              <Button variant="default" onClick={close}>
                {t("취소")}
              </Button>
            </>
          )}
          {login.error && <Alert color="red">{login.error.message}</Alert>}
        </Stack>
      </Modal>
    </Stack>
  );
};
