import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  PasswordInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { AuthSettingsField } from "@mcp-cli/core";
import { call } from "./ipc";
import { t } from "./i18n";
import {
  formatStrings,
  jsonObjectError,
  optionsKey,
  parseStrings,
  stringsText,
  valueAt,
} from "./auth-settings-form";

type FieldProps = {
  field: AuthSettingsField;
  configuration: Record<string, unknown>;
  service: string;
  workspace?: string;
  disabled: boolean;
  change: (value: unknown) => void;
};
type Common = { label: string; description?: string; disabled: boolean };

const StringsField = ({
  common,
  value,
  change,
}: {
  common: Common;
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

const OptionsField = ({
  field,
  configuration,
  service,
  workspace,
  disabled,
  change,
}: FieldProps) => {
  const [loaded, setLoaded] = useState<{ key: string; options: string[] }>();
  const key = optionsKey(field, configuration);
  const load = useMutation({
    mutationFn: (request: { key: string; configuration: Record<string, unknown> }) =>
      call("authOptions", {
        service,
        workspace,
        path: field.path,
        configuration: request.configuration,
      }),
    onSuccess: (options, request) =>
      setLoaded({ key: request.key, options: options.map((option) => option.value) }),
  });
  const value = valueAt(configuration, field.path);
  return (
    <Stack gap="xs">
      <Autocomplete
        label={field.label}
        description={field.description}
        value={typeof value === "string" ? value : ""}
        data={loaded?.key === key ? loaded.options : []}
        disabled={disabled}
        onChange={change}
        limit={100}
      />
      <Button
        variant="default"
        size="xs"
        loading={load.isPending}
        disabled={disabled}
        onClick={() => load.mutate({ key, configuration })}
        style={{ alignSelf: "flex-start" }}
      >
        {field.optionsSource?.label}
      </Button>
      {loaded?.key === key && (
        <Text size="xs" c="dimmed">
          {t("모델 {count}개를 불러왔습니다.", { count: loaded.options.length })}
        </Text>
      )}
      {load.error && load.variables?.key === key && <Alert color="red">{load.error.message}</Alert>}
    </Stack>
  );
};

export const SettingsField = (props: FieldProps) => {
  const { field, configuration, disabled, change } = props;
  const value = valueAt(configuration, field.path);
  const common = { label: field.label, description: field.description, disabled };
  if (field.optionsSource) return <OptionsField {...props} />;
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
  if (field.type === "password")
    return (
      <PasswordInput
        {...common}
        placeholder={
          field.storedPath && valueAt(configuration, field.storedPath) === true
            ? t("저장됨 · 변경할 때만 입력")
            : undefined
        }
        value={typeof value === "string" ? value : ""}
        onChange={(event) => change(event.currentTarget.value)}
      />
    );
  if (field.type === "json")
    return (
      <Textarea
        {...common}
        autosize
        minRows={3}
        error={
          typeof value === "string" && jsonObjectError(value)
            ? t("JSON 객체를 입력해 주세요.")
            : undefined
        }
        value={typeof value === "string" ? value : ""}
        styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        onChange={(event) => change(event.currentTarget.value)}
      />
    );
  return (
    <TextInput
      {...common}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => change(event.currentTarget.value)}
    />
  );
};
