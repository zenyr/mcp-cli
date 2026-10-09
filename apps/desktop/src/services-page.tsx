import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAction, useServices } from "./queries";
import type { Service } from "./ipc";

type Selection = { service: Service; credential: Service["credentials"][number] };
export const ServicesPage = () => {
  const { data, isPending, error } = useServices();
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
        { service: item.service.name, credential: item.credential.flag },
        { onSuccess: () => setSelection(undefined) },
      );
  };
  const close = () => {
    if (login.isPending) cancel.mutate(undefined);
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
        logout.mutate({ service: item.service.name, credential: item.credential.flag }),
    });
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>서비스</Title>
        <Text size="xs" c="dimmed">
          CLI와 같은 인증을 사용합니다.
        </Text>
      </Group>
      {error && (
        <Alert color="red" title="서비스를 가져오지 못했습니다">
          {error.message}
        </Alert>
      )}
      {isPending && <Loader size="sm" />}
      {data && (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={480}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>서비스</Table.Th>
                  <Table.Th>자격 증명</Table.Th>
                  <Table.Th>인증 상태</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.flatMap((service) =>
                  service.credentials.map((credential) => {
                    const item = { service, credential };
                    const state =
                      service.auth === "none"
                        ? "인증 없음"
                        : credential.fromEnv
                          ? "환경 변수 사용"
                          : credential.stored
                            ? "저장됨"
                            : "로그인 필요";
                    const color =
                      service.auth === "none"
                        ? "gray"
                        : credential.fromEnv
                          ? "violet"
                          : credential.stored
                            ? "teal"
                            : "orange";
                    return (
                      <Table.Tr key={`${service.name}:${credential.flag}`}>
                        <Table.Td>
                          <Stack gap={2}>
                            <Code>{service.name}</Code>
                            <Text size="xs" c="dimmed">
                              {service.summary}
                            </Text>
                          </Stack>
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
                              <Button
                                variant="default"
                                disabled={login.isPending || logout.isPending}
                                onClick={() => begin(item)}
                              >
                                {service.auth === "apiKey" ? "키 저장" : "로그인"}
                              </Button>
                              {credential.stored && (
                                <Button
                                  variant="subtle"
                                  color="red"
                                  disabled={login.isPending || logout.isPending}
                                  onClick={() => remove(item)}
                                >
                                  로그아웃
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
      <Text size="xs" c="dimmed">
        환경 변수 상태는 앱이 실행한 CLI 기준입니다. 터미널의 환경 변수는 명령마다 우선 적용됩니다.
      </Text>
      <Modal
        opened={Boolean(selection)}
        onClose={close}
        title={`${selection?.service.name ?? ""} ${selection?.service.auth === "apiKey" ? "API key 저장" : "로그인"}`}
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
                description="키는 CLI의 인증 저장소에 저장합니다."
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
                <Loader size="sm" />
                <Text size="sm">브라우저에서 로그인을 완료해 주세요.</Text>
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
