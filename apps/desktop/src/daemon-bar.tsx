import { Badge, Button, Group, Loader, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useAction, useStatus } from "./queries";

export const DaemonBar = () => {
  const { data, isPending } = useStatus();
  const start = useAction("start");
  const reset = useAction("reset", "연결을 초기화했습니다.");
  const stop = useAction("stop");
  const online = data?.online === true;
  const status = data?.online ? data.status : undefined;
  const active =
    status?.connections.reduce((count, connection) => count + connection.active, 0) ?? 0;
  const busy = start.isPending || reset.isPending || stop.isPending;
  const stopDaemon = () => {
    if (!active) {
      stop.mutate(undefined);
      return;
    }
    modals.openConfirmModal({
      title: "백그라운드 연결을 중지할까요?",
      children: <Text size="sm">진행 중 요청 {active}개가 끝나면 종료합니다.</Text>,
      labels: { confirm: "종료", cancel: "취소" },
      confirmProps: { color: "red" },
      onConfirm: () => stop.mutate(undefined),
    });
  };
  return (
    <Group h="100%" px="lg" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        {isPending || busy ? (
          <Loader size={14} />
        ) : (
          <Badge color={online ? "teal" : "gray"} variant="dot">
            {online ? "준비됨" : "중지됨"}
          </Badge>
        )}
        {busy && (
          <Text size="xs">
            {reset.isPending
              ? "진행 중 요청을 기다립니다"
              : stop.isPending
                ? "종료 요청을 보냅니다"
                : "연결을 준비합니다"}
          </Text>
        )}
        {!busy && status && (
          <Text size="xs" c="dimmed">
            열린 연결 {status.connections.length}개
          </Text>
        )}
      </Group>
      <Group gap="xs" wrap="nowrap">
        {online ? (
          <>
            <Button
              variant="default"
              disabled={busy || !status?.connections.length}
              onClick={() => reset.mutate(undefined)}
            >
              연결 초기화
            </Button>
            <Button variant="subtle" color="red" disabled={busy} onClick={stopDaemon}>
              연결 중지
            </Button>
          </>
        ) : (
          <Button loading={busy} onClick={() => start.mutate(undefined)}>
            연결 준비
          </Button>
        )}
      </Group>
    </Group>
  );
};
