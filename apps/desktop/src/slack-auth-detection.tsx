import { useState } from "react";
import { Alert, Button, Group, PasswordInput, Stack, Text } from "@mantine/core";
import type { SlackDetection, SlackTarget } from "../../../plugins/slack/src/auth-types";
import { useAction } from "./queries";

const label = (value: boolean | undefined) =>
  value === true ? "활성화" : value === false ? "비활성화" : "미확인";
export const SlackAuthDetection = ({
  target,
  detection,
  disabled,
  tokenDisabled,
  onToken,
}: {
  target: SlackTarget;
  detection?: SlackDetection & { rotatingCredential: boolean };
  disabled: boolean;
  tokenDisabled: boolean;
  onToken: (credential: "xoxp" | "xoxb") => void;
}) => {
  const [secret, setSecret] = useState("");
  const inspect = useAction("authDetect");
  const busy = disabled || inspect.isPending;
  return (
    <Stack gap="sm">
      <Group>
        <Button variant="default" disabled={tokenDisabled} onClick={() => onToken("xoxp")}>
          사용자 토큰 저장
        </Button>
        <Button variant="default" disabled={tokenDisabled} onClick={() => onToken("xoxb")}>
          봇 토큰 저장
        </Button>
      </Group>
      <Text size="xs">
        토큰은 언제든 저장할 수 있습니다. 저장한 사용자 토큰을 사용하려면 로그인 방법에서 토큰
        입력을 선택합니다.
      </Text>
      <Alert color={detection?.available ? "blue" : "gray"} title="Slack App 설정 감지">
        {detection?.available ? (
          <>
            <Text size="sm">
              PKCE: {label(detection.pkce)} · 토큰 회전 설정: {label(detection.rotation)}
            </Text>
            <Text size="xs">조회 시각: {new Date(detection.checkedAt ?? 0).toLocaleString()}</Text>
          </>
        ) : (
          <Text size="sm">
            아직 설정을 확인하지 못했습니다. 미확인을 비활성화로 처리하지 않습니다.
          </Text>
        )}
        <Text size="xs">
          현재 저장된 브라우저 인증의 자동 갱신:{" "}
          {detection?.rotatingCredential ? "가능" : "미확인 또는 갱신 정보 없음"}
        </Text>
      </Alert>
      <PasswordInput
        label="App configuration token"
        autoComplete="off"
        value={secret}
        disabled={busy}
        description="선택 항목입니다. app_configurations:read 권한이 필요합니다. 사용자·봇 토큰이나 Client Secret을 넣지 마세요."
        onChange={(event) => setSecret(event.currentTarget.value)}
      />
      <Group>
        <Button
          variant="light"
          loading={inspect.isPending}
          disabled={disabled}
          onClick={() => {
            const value = secret.trim();
            setSecret("");
            inspect.mutate({ service: "slack", target, ...(value ? { secret: value } : {}) });
          }}
        >
          {secret.trim() ? "조회하고 조회용 토큰 저장" : "저장된 조회용 토큰으로 감지"}
        </Button>
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => {
            setSecret("");
            inspect.mutate({ service: "slack", target, forget: true });
          }}
        >
          조회용 토큰 삭제
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        먼저 App ID와 설정을 저장해 주세요. 조회는 Slack 설정을 변경하지 않습니다. 조회용 토큰은
        별도 자격 증명 파일에 저장합니다.
      </Text>
      {inspect.error && <Alert color="red">{inspect.error.message}</Alert>}
    </Stack>
  );
};
