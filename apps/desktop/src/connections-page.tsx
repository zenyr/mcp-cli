import { t, useLocale } from "./i18n";
import { Alert, Badge, Button, Code, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { IconPlugConnected } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStatus } from "./queries";

export const ConnectionsPage = () => {
  useLocale();
  const { data, isPending, error } = useStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const connections = data?.online ? data.status.connections : [];
  const idleMs = data?.online ? data.status.idleMs : 60_000;
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>{t("연결")}</Title>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      {data && !data.online && (
        <Alert color="gray" title={t("연결 준비가 필요합니다")}>
          {t("위의 연결 준비 버튼을 눌러 주세요.")}
          <Text size="xs" mt="xs" className="error-detail">
            {data.error}
          </Text>
        </Alert>
      )}
      {connections.length ? (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={520}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("서비스")}</Table.Th>
                  <Table.Th>{t("워크스페이스")}</Table.Th>
                  <Table.Th>{t("자격 증명")}</Table.Th>
                  <Table.Th>{t("상태")}</Table.Th>
                  <Table.Th>{t("요청")}</Table.Th>
                  <Table.Th>{t("마지막 사용")}</Table.Th>
                  <Table.Th>{t("닫힘까지")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...connections]
                  .sort((a, b) => a.service.localeCompare(b.service))
                  .map((connection) => (
                    <Table.Tr key={connection.id}>
                      <Table.Td>
                        <Code>{connection.service}</Code>
                      </Table.Td>
                      <Table.Td>{connection.workspace || "default"}</Table.Td>
                      <Table.Td>{connection.credential || t("기본")}</Table.Td>
                      <Table.Td>
                        <Badge color={connection.active ? "teal" : "gray"}>
                          {connection.active
                            ? t("사용 중")
                            : connection.leases
                              ? t("CLI 연결")
                              : t("유휴")}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{connection.active}</Table.Td>
                      <Table.Td>
                        {connection.active || connection.leases
                          ? t("사용 중")
                          : t("{count}초 전", {
                              count: Math.max(0, Math.floor((now - connection.lastUsed) / 1000)),
                            })}
                      </Table.Td>
                      <Table.Td>
                        {connection.active || connection.leases
                          ? "—"
                          : t("{count}초", {
                              count: Math.max(
                                0,
                                Math.ceil((connection.lastUsed + idleMs - now) / 1000),
                              ),
                            })}
                      </Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      ) : (
        <Paper withBorder p="xl">
          <Stack align="center" gap="sm" py="xl">
            <IconPlugConnected size={28} color="var(--mantine-color-dimmed)" />
            <Text fw={500}>
              {isPending ? t("연결을 확인합니다") : t("아직 열린 연결이 없습니다")}
            </Text>

            <details>
              <summary>{t("터미널에서 연결 유지 사용하기")}</summary>
              <Code>mcp-cli demo message echo --text hello</Code>
            </details>
            <Button component={Link} to="/plugins" variant="subtle">
              {t("서비스 인증 확인")}
            </Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
};
