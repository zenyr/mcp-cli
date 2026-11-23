import { t, useLocale } from "./i18n";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { isRecord, type AuthSettingsField } from "@mcp-cli/core";
import { useAction } from "./queries";
import type { Authentication } from "./ipc";
import {
  authChanged,
  formatStrings,
  parseStrings,
  stringsText,
  syncDraft,
} from "./auth-settings-form";

const stateLabels = {
  missing: "로그인 필요",
  configured: "설정됨",
  stored: "저장됨",
  connected: "연결 확인됨",
  expired: "만료됨",
  reauth: "재로그인 필요",
  failed: "확인 실패",
} as const;

const valueAt = (record: Record<string, unknown>, path: string[]): unknown => {
  let value: unknown = record;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return value;
};
const updateAt = (
  record: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> => {
  const [key, ...rest] = path;
  if (!key) return record;
  const previous = record[key];
  return {
    ...record,
    [key]: rest.length ? updateAt(isRecord(previous) ? previous : {}, rest, value) : value,
  };
};

const StringsField = ({
  common,
  value,
  change,
}: {
  common: { label: string; description?: string; disabled: boolean };
  value: unknown;
  change: (value: unknown) => void;
}) => {
  const [text, setText] = useState(() => formatStrings(value));
  return (
    <Textarea
      {...common}
      value={stringsText(text, value)}
      onChange={(event) => {
        setText(event.currentTarget.value);
        change(parseStrings(event.currentTarget.value));
      }}
    />
  );
};

const SettingsField = ({
  field,
  value,
  disabled,
  change,
}: {
  field: AuthSettingsField;
  value: unknown;
  disabled: boolean;
  change: (value: unknown) => void;
}) => {
  const common = { label: field.label, description: field.description, disabled };
  if (field.type === "boolean")
    return (
      <Checkbox
        {...common}
        checked={value === true}
        onChange={(event) => change(event.currentTarget.checked)}
      />
    );
  if (field.type === "select")
    return (
      <Select
        {...common}
        data={field.options ?? []}
        value={typeof value === "string" ? value : null}
        onChange={(next) => {
          if (next !== null) change(next);
        }}
      />
    );
  if (field.type === "strings")
    return <StringsField common={common} value={value} change={change} />;
  return (
    <TextInput
      {...common}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => change(event.currentTarget.value)}
    />
  );
};

export const AuthSettingsPanel = ({
  service,
  workspace,
  workspaceName,
  authentication,
}: {
  service: string;
  workspace?: string;
  workspaceName?: string;
  authentication: Authentication;
}) => {
  useLocale();
  const [seen, setSeen] = useState(authentication);
  const [base, setBase] = useState(authentication.configuration);
  const [configuration, setConfiguration] = useState(authentication.configuration);
  const [checked, setChecked] = useState<Authentication>();
  const [group, setGroup] = useState(authentication.fields[0]?.path[0] ?? "");
  const save = useAction(
    "authConfig",
    authentication.states.length
      ? t("인증 설정을 저장했습니다. 변경한 설정으로 다시 로그인해 주세요.")
      : t("설정을 저장했습니다."),
  );
  const verify = useAction("authStatus");
  const login = useAction("login", t("인증을 저장했습니다."));
  const logout = useAction("logout", t("이 기기의 인증을 삭제했습니다."));
  const cancel = useAction("cancelLogin");
  const [url, setUrl] = useState("");
  useEffect(
    () =>
      window.tiny?.api.on("open-url", (value) => {
        if (typeof value === "string" && /^https?:\/\//.test(value)) setUrl(value);
      }),
    [],
  );
  if (seen !== authentication) {
    setSeen(authentication);
    if (authChanged(seen, authentication)) {
      setConfiguration(syncDraft(base, authentication.configuration, configuration));
      setBase(authentication.configuration);
      setChecked(undefined);
      if (!login.isPending) setUrl("");
    }
  }
  const resetStatus = () => {
    setChecked(undefined);
    setUrl("");
  };
  const adopt = (result: Authentication) => {
    setBase(result.configuration);
    setConfiguration(result.configuration);
    resetStatus();
  };
  const groups = [
    ...new Set(
      authentication.fields
        .filter((field) => field.path.length > 1)
        .map((field) => field.path[0] ?? ""),
    ),
  ];
  const busy =
    save.isPending || verify.isPending || login.isPending || logout.isPending || cancel.isPending;
  const dirty = JSON.stringify(configuration) !== JSON.stringify(base);
  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={4}>
            {service}
            {workspaceName ? ` / ${workspaceName}` : ""}{" "}
            {t(authentication.states.length ? "인증 설정" : "설정")}
          </Title>
          {authentication.states.length > 0 && (
            <Button
              variant="default"
              loading={verify.isPending}
              disabled={busy && !verify.isPending}
              onClick={() => verify.mutate({ service, workspace }, { onSuccess: setChecked })}
            >
              {t("연결 확인")}
            </Button>
          )}
        </Group>
        {authentication.states.length > 0 && (
          <Text size="sm">
            {t(
              "서비스 관리자 화면에서 확인한 값을 입력하세요. PKCE 활성화와 등록한 Redirect URL을 먼저 확인하세요.",
            )}
          </Text>
        )}
        {(checked?.states ?? authentication.states).map((state) => (
          <Group key={state.target}>
            <Text size="sm" fw={500}>
              {state.target}
            </Text>
            <Badge color={state.state === "connected" ? "teal" : "gray"}>
              {t(stateLabels[state.state])}
            </Badge>
            <Text size="sm">{state.detail}</Text>
            <Button
              size="xs"
              variant="default"
              disabled={dirty || busy}
              onClick={() =>
                login.mutate(
                  { service, workspace, target: state.target, method: "browser" },
                  { onSettled: resetStatus },
                )
              }
            >
              {t("브라우저 로그인")}
            </Button>
            <Button
              size="xs"
              color="red"
              variant="subtle"
              disabled={busy}
              onClick={() =>
                logout.mutate(
                  { service, workspace, target: state.target },
                  { onSuccess: resetStatus },
                )
              }
            >
              {t("인증 삭제")}
            </Button>
          </Group>
        ))}
        {login.isPending && (
          <Group>
            <Text size="sm">{t("브라우저에서 로그인을 완료하세요.")}</Text>
            <Button variant="default" onClick={() => cancel.mutate()}>
              {t("로그인 취소")}
            </Button>
          </Group>
        )}
        {url && (
          <Group>
            <Button
              variant="default"
              onClick={() => {
                void window.tiny?.app.shell.open(url);
              }}
            >
              {t("로그인 브라우저 열기")}
            </Button>
            <Button
              variant="subtle"
              onClick={() => {
                void window.tiny?.clipboard.write({ text: url });
              }}
            >
              {t("로그인 주소 복사")}
            </Button>
          </Group>
        )}
        {groups.length > 1 && (
          <Select
            label={t("설정 대상")}
            data={groups}
            value={group}
            disabled={busy}
            onChange={(value) => {
              if (value) setGroup(value);
            }}
          />
        )}
        {authentication.fields
          .filter((field) => field.path.length === 1 || field.path[0] === group)
          .map((field) => (
            <SettingsField
              key={field.path.join(".")}
              field={field}
              disabled={busy}
              value={valueAt(configuration, field.path)}
              change={(value) =>
                setConfiguration((current) => updateAt(current, field.path, value))
              }
            />
          ))}
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        {login.error && <Alert color="red">{login.error.message}</Alert>}
        <Group>
          <Button
            disabled={!dirty || busy}
            loading={save.isPending}
            onClick={() => save.mutate({ service, workspace, configuration }, { onSuccess: adopt })}
          >
            {t("설정 저장")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
};
