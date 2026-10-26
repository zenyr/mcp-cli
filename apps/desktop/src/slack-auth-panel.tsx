import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import type {
  SlackConfiguration,
  SlackProfile,
  SlackTarget,
} from "../../../plugins/slack/src/auth-types";
import type { Authentication } from "./ipc";
import { useAction } from "./queries";

const labels = {
  missing: "로그인 필요",
  configured: "설정됨",
  stored: "저장됨 · 확인 필요",
  connected: "연결 확인됨",
  expired: "만료됨",
  reauth: "재로그인 필요",
  failed: "확인 실패",
};
export const SlackAuthPanel = ({ authentication }: { authentication: Authentication }) => {
  const [configuration, setConfiguration] = useState<SlackConfiguration>(
    authentication.configuration,
  );
  const [target, setTarget] = useState<SlackTarget>("mcp");
  const [loggingIn, setLoggingIn] = useState<SlackTarget>();
  const [url, setUrl] = useState("");
  const save = useAction(
    "authConfig",
    "Slack 설정을 저장했습니다. 변경한 설정으로 다시 로그인해 주세요.",
  );
  const login = useAction("login", "인증을 저장했습니다. 연결 확인을 실행해 주세요.");
  const logout = useAction(
    "logout",
    "이 기기의 브라우저 인증을 삭제했습니다. Slack의 앱 승인은 유지됩니다.",
  );
  const verify = useAction("authStatus");
  const cancel = useAction("cancelLogin");
  const busy =
    login.isPending || save.isPending || logout.isPending || cancel.isPending || verify.isPending;
  const profile = configuration[target];
  const edit = (value: Partial<SlackProfile>) => {
    verify.reset();
    setConfiguration((current) => ({ ...current, [target]: { ...current[target], ...value } }));
  };
  const dirty = JSON.stringify(configuration) !== JSON.stringify(authentication.configuration);
  useEffect(
    () =>
      window.tiny?.api.on("open-url", (value) => {
        if (typeof value === "string") setUrl(value);
      }),
    [],
  );
  const begin = () => {
    verify.reset();
    setLoggingIn(target);
    setUrl("");
    login.mutate(
      { service: "slack", target, method: "browser" },
      {
        onSuccess: (result) => {
          if (result === null) setLoggingIn(undefined);
        },
      },
    );
  };
  const close = () => {
    if (login.isPending) cancel.mutate(undefined);
    setLoggingIn(undefined);
    setUrl("");
  };
  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={4}>Slack 로그인 설정</Title>
          <Button
            variant="default"
            loading={verify.isPending}
            disabled={busy && !verify.isPending}
            onClick={() => verify.mutate({ service: "slack" })}
          >
            연결 확인
          </Button>
        </Group>
        <Text size="sm">
          Slack App 관리 화면에서 확인한 값을 입력해 주세요. 앱은 원격 설정을 자동 감지하지
          않습니다.
        </Text>
        <Text size="xs" c="dimmed">
          환경 변수는 항상 우선합니다. 사용자 토큰과 봇 토큰은 위 목록에서 입력합니다. MCP와 Web
          API의 승인은 각각 확인합니다.
        </Text>
        <Group align="flex-start">
          {(verify.data?.states ?? authentication.states).map((state) => (
            <Stack key={state.target} gap={4} style={{ flex: 1 }}>
              <Text size="sm" fw={600}>
                {state.target === "mcp" ? "Slack MCP" : "Slack Web API"}
              </Text>
              <Badge color={state.state === "connected" ? "teal" : "gray"}>
                {labels[state.state]}
              </Badge>
              <Text size="xs">{state.detail}</Text>
            </Stack>
          ))}
        </Group>
        <Tabs
          value={target}
          onChange={(value) => {
            if (value === "mcp" || value === "web") setTarget(value);
          }}
        >
          <Tabs.List>
            <Tabs.Tab value="mcp">MCP</Tabs.Tab>
            <Tabs.Tab value="web">Web API</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Select
          label="로그인 방법"
          value={profile.method}
          disabled={busy}
          data={[
            { value: "token", label: "토큰 직접 입력" },
            { value: "pkce", label: "브라우저 로그인" },
          ]}
          onChange={(value) => {
            if (value === "token" || value === "pkce") edit({ method: value });
          }}
        />
        {profile.method === "pkce" ? (
          <>
            <Alert color="yellow">
              Slack에서 PKCE를 켜면 지원팀 없이 되돌릴 수 없습니다. 먼저 App 관리자와 설정을 확인해
              주세요. 브라우저 로그인은 사용자 권한만 지원합니다.
            </Alert>
            <Group grow>
              <TextInput
                label="Client ID"
                description="Basic Information에서 복사합니다. 비밀값이 아닙니다."
                value={profile.clientId ?? ""}
                disabled={busy}
                onChange={(event) => edit({ clientId: event.currentTarget.value })}
              />
              <TextInput
                label="App ID"
                value={profile.appId ?? ""}
                disabled={busy}
                onChange={(event) => edit({ appId: event.currentTarget.value })}
              />
            </Group>
            <TextInput
              label="워크스페이스 ID"
              description="승인할 워크스페이스의 T로 시작하는 ID입니다."
              value={profile.teamId ?? ""}
              disabled={busy}
              onChange={(event) => edit({ teamId: event.currentTarget.value })}
            />
            <TextInput
              label="등록한 Redirect URL"
              placeholder="http://localhost:8765/callback"
              description="Slack OAuth & Permissions에 같은 주소를 등록합니다. 다른 로그인과 포트를 공유하지 마세요."
              value={profile.redirectUri ?? ""}
              disabled={busy}
              onChange={(event) => edit({ redirectUri: event.currentTarget.value })}
            />
            <Textarea
              label="사용자 권한"
              description="User Token Scopes에 등록한 권한을 쉼표로 구분합니다. 필요한 권한만 입력해 주세요."
              value={profile.scopes?.join(", ") ?? ""}
              disabled={busy}
              onChange={(event) =>
                edit({ scopes: event.currentTarget.value.split(/[,\s]+/).filter(Boolean) })
              }
            />
            <Checkbox
              label="Slack App에서 PKCE 활성화를 확인했습니다"
              checked={profile.pkceEnabled === true}
              disabled={busy}
              onChange={(event) => edit({ pkceEnabled: event.currentTarget.checked })}
            />
            {target === "mcp" && (
              <>
                <Checkbox
                  label="이 App의 Slack MCP 접근 허용을 확인했습니다"
                  checked={profile.mcpEnabled === true}
                  disabled={busy}
                  onChange={(event) => edit({ mcpEnabled: event.currentTarget.checked })}
                />
                <Select
                  label="Slack App 배포 상태"
                  placeholder="관리 화면에서 확인한 상태를 선택합니다"
                  value={profile.distribution ?? null}
                  disabled={busy}
                  data={[
                    { value: "internal", label: "내부 앱" },
                    { value: "marketplace", label: "Marketplace 게시 완료" },
                    { value: "unlisted", label: "미게시 배포 앱" },
                  ]}
                  onChange={(value) => {
                    if (value === "internal" || value === "marketplace" || value === "unlisted")
                      edit({ distribution: value });
                  }}
                />
              </>
            )}
            <Text size="xs" c="dimmed">
              Client Secret은 입력하지 않습니다. 이 App이 PKCE를 지원하지 않으면 토큰 입력 방식을
              사용해 주세요.
            </Text>
          </>
        ) : (
          <Text size="sm">
            위 목록에서 xoxp 사용자 토큰 또는 xoxb 봇 토큰을 저장한 뒤 이 설정을 저장해 주세요. 봇
            토큰은 Web API 권한 범위에서 사용합니다.
          </Text>
        )}
        <Group>
          <Button
            loading={save.isPending}
            disabled={!dirty || busy}
            onClick={() => save.mutate({ service: "slack", configuration })}
          >
            설정 저장
          </Button>
          {profile.method === "pkce" && (
            <Button variant="default" disabled={dirty || busy} onClick={begin}>
              {target === "mcp" ? "MCP" : "Web API"} 로그인 / 재로그인
            </Button>
          )}
          <Button
            color="red"
            variant="subtle"
            disabled={busy}
            onClick={() => {
              verify.reset();
              logout.mutate({ service: "slack", target });
            }}
          >
            이 대상의 브라우저 인증 삭제
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          설정 저장은 기존 토큰을 삭제하지 않습니다. App·워크스페이스·권한·주소·로그인 방법이 바뀌면
          다시 로그인합니다. 로그아웃은 로컬 삭제이며 Slack의 원격 승인을 취소하지 않습니다.
        </Text>
      </Stack>
      <Modal
        opened={loggingIn !== undefined}
        onClose={close}
        title="Slack 브라우저 로그인"
        centered
      >
        <Stack>
          <Text>
            {login.isPending
              ? "브라우저에서 승인을 완료해 주세요. 5분 뒤 로그인 요청이 만료됩니다."
              : "로그인 결과를 확인해 주세요."}
          </Text>
          {url && (
            <Button
              variant="default"
              onClick={() => {
                void window.tiny?.app.shell.open(url);
              }}
            >
              브라우저 다시 열기
            </Button>
          )}
          {login.error && <Alert color="red">{login.error.message}</Alert>}
          <Button variant="default" onClick={close}>
            취소 / 닫기
          </Button>
        </Stack>
      </Modal>
    </Paper>
  );
};
