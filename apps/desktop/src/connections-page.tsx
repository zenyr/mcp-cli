import { Alert, Badge, Button, Code, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { IconPlugConnected } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStatus } from "./queries";

export const ConnectionsPage = () => {
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
        <Title order={3}>연결</Title>
        <Text size="xs" c="dimmed">
          유휴 연결은 {idleMs / 1000}초 뒤 닫힙니다.
        </Text>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      {data && !data.online && (
        <Alert color="gray" title="대몬에 연결하지 못했습니다">
          대몬을 시작하거나 설정에서 CLI 경로를 확인해 주세요.
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
                  <Table.Th>서비스</Table.Th>
                  <Table.Th>자격 증명</Table.Th>
                  <Table.Th>상태</Table.Th>
                  <Table.Th>요청</Table.Th>
                  <Table.Th>마지막 사용</Table.Th>
                  <Table.Th>닫힘까지</Table.Th>
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
                      <Table.Td>{connection.credential || "기본"}</Table.Td>
                      <Table.Td>
                        <Badge color={connection.active ? "teal" : "gray"}>
                          {connection.active ? "사용 중" : connection.leases ? "CLI 연결" : "유휴"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{connection.active}</Table.Td>
                      <Table.Td>
                        {connection.active || connection.leases
                          ? "사용 중"
                          : `${Math.max(0, Math.floor((now - connection.lastUsed) / 1000))}초 전`}
                      </Table.Td>
                      <Table.Td>
                        {connection.active || connection.leases
                          ? "—"
                          : `${Math.max(0, Math.ceil((connection.lastUsed + idleMs - now) / 1000))}초`}
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
            <Text fw={500}>{isPending ? "연결을 확인합니다" : "아직 열린 연결이 없습니다"}</Text>
            <Text size="sm" c="dimmed" ta="center">
              대몬 사용을 켠 CLI 명령이 실행되면 여기에 표시됩니다.
            </Text>
            <Code>MCP_CLI_DAEMON=1 mcp-cli demo message echo --text hello</Code>
            <Button component={Link} to="/services" variant="subtle">
              서비스 인증 확인
            </Button>
          </Stack>
        </Paper>
      )}
      <Text size="xs" c="dimmed">
        창을 닫아도 대몬은 연결을 유지합니다. 앱 종료와 대몬 종료는 별도입니다.
      </Text>
    </Stack>
  );
};
