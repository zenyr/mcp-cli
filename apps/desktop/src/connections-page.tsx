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
        <Alert color="gray" title="연결 준비가 필요합니다">
          위의 연결 준비 버튼을 눌러 주세요.
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
              연결 유지를 사용하는 도구의 요청이 여기에 표시됩니다.
            </Text>
            <details>
              <summary>터미널에서 연결 유지 사용하기</summary>
              <Code>MCP_CLI_DAEMON=1 mcp-cli demo message echo --text hello</Code>
            </details>
            <Button component={Link} to="/services" variant="subtle">
              서비스 인증 확인
            </Button>
          </Stack>
        </Paper>
      )}
      <Text size="xs" c="dimmed">
        창을 닫아도 백그라운드 연결은 유지됩니다. 연결을 끝내려면 연결 중지를 눌러 주세요.
      </Text>
    </Stack>
  );
};
