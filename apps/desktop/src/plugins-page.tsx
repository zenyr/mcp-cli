import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { MarketplaceAction, MarketplacePlugin } from "@mcp-cli/core";
import { useAction, usePlugins } from "./queries";

export const PluginsPage = () => {
  const { data, error, isPending } = usePlugins();
  const action = useAction("pluginAction");
  const [repository, setRepository] = useState("");
  const [directory, setDirectory] = useState("");
  const [selection, setSelection] = useState<{
    plugin: MarketplacePlugin;
    operation: "install" | "enable";
  }>();
  const [allowCode, setAllowCode] = useState(false);
  const run = (request: MarketplaceAction) => action.mutate(request);
  const select = (plugin: MarketplacePlugin, operation: "install" | "enable") => {
    setAllowCode(false);
    setSelection({ plugin, operation });
  };
  const permissions =
    selection?.operation === "enable"
      ? (selection.plugin.installedPermissions ?? selection.plugin.permissions)
      : selection?.plugin.permissions;
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>플러그인</Title>
        <Text size="sm" c="dimmed">
          필요한 플러그인만 설치하고 활성화하세요.
        </Text>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      {action.error && <Alert color="red">{action.error.message}</Alert>}
      {action.data && <Alert color="teal">{action.data.message}</Alert>}
      {isPending && <Text>플러그인 목록을 확인합니다.</Text>}
      {data && !data.sources.length && !data.plugins.length && (
        <Alert color="gray">
          등록한 카탈로그가 없습니다. 추천 목록에서 선택하거나 저장소 주소를 추가하세요.
        </Alert>
      )}
      {data &&
        data.recommendations.some(
          (item) => !data.sources.some((source) => source.id === item.id),
        ) && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Title order={4}>추천 카탈로그</Title>
              {data.recommendations
                .filter((item) => !data.sources.some((source) => source.id === item.id))
                .map((item) => (
                  <Group key={item.id} justify="space-between" align="flex-start">
                    <Stack gap={3}>
                      <Text fw={500}>{item.name}</Text>
                      <Text size="sm" c="dimmed">
                        {item.description}
                      </Text>
                    </Stack>
                    <Button
                      disabled={action.isPending}
                      onClick={() => run({ type: "source.add", url: item.url })}
                    >
                      불러오기
                    </Button>
                  </Group>
                ))}
            </Stack>
          </Paper>
        )}
      {data && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>터미널 명령</Text>
              <Badge color={data.onPath ? "teal" : "gray"}>
                {data.onPath ? "PATH 등록됨" : "PATH 설정 확인"}
              </Badge>
            </Group>
            <Text size="sm">
              활성화한 플러그인의 명령을 <Code>{data.commandDirectory}</Code>에 만듭니다.
            </Text>
            <Group>
              <Button
                variant="default"
                loading={action.isPending}
                onClick={() => run({ type: "commands.install" })}
              >
                PATH에 등록
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              등록 후 새 터미널을 열어 주세요. 기존 명령 파일은 덮어쓰지 않습니다.
            </Text>
          </Stack>
        </Paper>
      )}
      {data?.plugins.map((plugin) => (
        <Paper key={plugin.key} withBorder p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Stack gap={3}>
                <Group gap="xs">
                  <Text fw={600}>{plugin.name}</Text>
                  <Badge color={plugin.revoked ? "red" : plugin.enabled ? "teal" : "gray"}>
                    {plugin.revoked
                      ? "차단됨"
                      : plugin.enabled
                        ? "활성화됨"
                        : plugin.installed
                          ? "비활성화됨"
                          : "설치 가능"}
                  </Badge>
                  {plugin.development && <Badge variant="outline">개발</Badge>}
                </Group>
                <Text size="sm">{plugin.description}</Text>
                <Text size="xs" c="dimmed">
                  {plugin.sourceName} · {plugin.installedVersion ?? plugin.version} · 명령{" "}
                  <Code>{plugin.service}</Code>
                </Text>
              </Stack>
              <Group gap="xs">
                {!plugin.installed && (
                  <Button
                    disabled={!plugin.supported || action.isPending || Boolean(plugin.revoked)}
                    onClick={() => select(plugin, "install")}
                  >
                    설치
                  </Button>
                )}
                {plugin.installed && (
                  <>
                    {plugin.updateAvailable && (
                      <Button
                        variant="default"
                        disabled={!plugin.supported || action.isPending}
                        onClick={() => select(plugin, "install")}
                      >
                        업데이트
                      </Button>
                    )}
                    <Button
                      variant={plugin.enabled ? "default" : "filled"}
                      disabled={action.isPending || Boolean(plugin.revoked)}
                      onClick={() =>
                        plugin.enabled
                          ? run({ type: "plugin.enable", key: plugin.key, enabled: false })
                          : select(plugin, "enable")
                      }
                    >
                      {plugin.enabled ? "비활성화" : "활성화"}
                    </Button>
                    <Button
                      color="red"
                      variant="subtle"
                      disabled={action.isPending}
                      onClick={() => run({ type: "plugin.remove", key: plugin.key })}
                    >
                      제거
                    </Button>
                  </>
                )}
              </Group>
            </Group>
            {!plugin.supported && (
              <Text size="sm" c="dimmed">
                이 운영체제와 CPU에 맞는 배포 파일이 없습니다.
              </Text>
            )}
            {plugin.revoked && <Alert color="red">{plugin.revoked}</Alert>}
          </Stack>
        </Paper>
      ))}
      <Paper withBorder p="md">
        <Stack gap="md">
          <Title order={4}>카탈로그 저장소</Title>
          <Text size="sm">
            GitHub 또는 Forgejo의 HTTPS Git 주소를 추가하세요. 목록 갱신은 플러그인을 실행하지
            않습니다.
          </Text>
          <Group align="end">
            <TextInput
              style={{ flex: 1 }}
              label="저장소 주소"
              placeholder="https://git.example.com/team/mcp-plugins.git"
              value={repository}
              onChange={(event) => setRepository(event.currentTarget.value)}
            />
            <Button
              disabled={!repository.trim() || action.isPending}
              onClick={() =>
                action.mutate(
                  { type: "source.add", url: repository.trim() },
                  { onSuccess: () => setRepository("") },
                )
              }
            >
              추가
            </Button>
          </Group>
          {data?.sources.map((source) => (
            <Group key={source.id} justify="space-between">
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  {source.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {source.url === "builtin" ? "앱에 포함된 카탈로그" : source.url} ·{" "}
                  {source.commit.slice(0, 8)}
                </Text>
              </Stack>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  disabled={action.isPending}
                  onClick={() => run({ type: "source.refresh", id: source.id })}
                >
                  목록 갱신
                </Button>
                <Button
                  size="xs"
                  color="red"
                  variant="subtle"
                  disabled={action.isPending}
                  onClick={() => run({ type: "source.remove", id: source.id })}
                >
                  제거
                </Button>
              </Group>
            </Group>
          ))}
        </Stack>
      </Paper>
      <details>
        <summary>플러그인 개발</summary>
        <Stack mt="sm">
          <Text size="sm">
            plugin.json과 manifest.json이 있는 로컬 폴더를 연결합니다. 개발 폴더의 코드는 다음
            실행에 반영됩니다.
          </Text>
          <Group align="end">
            <TextInput
              style={{ flex: 1 }}
              label="개발 폴더의 절대 경로"
              value={directory}
              onChange={(event) => setDirectory(event.currentTarget.value)}
            />
            <Button
              disabled={!directory.trim() || action.isPending}
              onClick={() =>
                action.mutate(
                  { type: "plugin.link", directory: directory.trim() },
                  { onSuccess: () => setDirectory("") },
                )
              }
            >
              연결
            </Button>
          </Group>
        </Stack>
      </details>
      <Modal
        opened={Boolean(selection)}
        onClose={() => {
          if (!action.isPending) setSelection(undefined);
        }}
        title={`${selection?.plugin.name ?? ""} ${selection?.operation === "install" ? "설치" : "활성화"}`}
        centered
      >
        {selection && permissions && (
          <Stack>
            <Text size="sm">출처: {selection.plugin.sourceName}</Text>
            <Text size="sm">네트워크: {permissions.network.join(", ") || "선언 없음"}</Text>
            <Text size="sm">파일 접근: {permissions.filesystem.join(", ") || "선언 없음"}</Text>
            {permissions.localCode && (
              <Alert color="yellow">
                활성화하면 다운로드한 플러그인을 이 컴퓨터에서 사용자 계정 권한으로 실행합니다.
                파일과 네트워크 접근을 운영체제 샌드박스로 제한하지 않습니다.
              </Alert>
            )}
            {selection.operation === "enable" && permissions.localCode && (
              <Checkbox
                label="이 출처의 플러그인을 이 컴퓨터에서 실행하도록 허용합니다"
                checked={allowCode}
                onChange={(event) => setAllowCode(event.currentTarget.checked)}
              />
            )}
            {selection.operation === "install" && (
              <Text size="sm">
                설치 후 비활성 상태로 유지합니다. 업데이트도 다시 활성화해야 실행합니다.
              </Text>
            )}
            <Button
              loading={action.isPending}
              disabled={selection.operation === "enable" && permissions.localCode && !allowCode}
              onClick={() => {
                const request: MarketplaceAction =
                  selection.operation === "install"
                    ? {
                        type: "plugin.install",
                        sourceId: selection.plugin.sourceId,
                        pluginId: selection.plugin.id,
                      }
                    : {
                        type: "plugin.enable",
                        key: selection.plugin.key,
                        enabled: true,
                        allowLocalCode: allowCode,
                      };
                action.mutate(request, { onSuccess: () => setSelection(undefined) });
              }}
            >
              {selection.operation === "install" ? "다운로드하고 검증" : "활성화"}
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
