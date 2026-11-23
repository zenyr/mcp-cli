import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Code, Stack, Text } from "@mantine/core";
import { currentTestResult, diagnosticText } from "./configuration-test-result";
import { t } from "./i18n";
import { call } from "./ipc";
import { requestErrorMessage } from "./request-error";

export const ConfigurationTest = ({
  service,
  workspace,
  configuration,
  disabled,
}: {
  service: string;
  workspace?: string;
  configuration: Record<string, unknown>;
  disabled: boolean;
}) => {
  const key = JSON.stringify(configuration);
  const test = useMutation({
    mutationFn: (request: { key: string; configuration: Record<string, unknown> }) =>
      call("authTest", { service, workspace, configuration: request.configuration }),
  });
  const current = currentTestResult(test.variables?.key, key);
  return (
    <Stack gap="xs">
      <Button
        variant="default"
        loading={test.isPending}
        disabled={disabled}
        onClick={() => test.mutate({ key, configuration })}
        style={{ alignSelf: "flex-start" }}
      >
        {t("테스트")}
      </Button>
      <Text size="xs" c="dimmed">
        {t(
          "현재 입력값으로 샘플 요약을 호출합니다. 설정은 저장하지 않습니다. API 사용 요금이 발생할 수 있습니다.",
        )}
      </Text>
      {current && test.error && <Alert color="red">{requestErrorMessage(test.error)}</Alert>}
      {current && test.data && (
        <Alert color="teal" title={t("테스트 호출 성공")}>
          <Stack gap="xs">
            <Text size="sm">{test.data.durationMs} ms</Text>
            <Text size="sm">{test.data.message}</Text>
            {test.data.details?.map((detail) =>
              detail.code ? (
                <details key={detail.label}>
                  <summary>{diagnosticText(detail.label, t)}</summary>
                  <Code block>{detail.value}</Code>
                </details>
              ) : (
                <Text size="sm" key={detail.label}>
                  {diagnosticText(detail.label, t)}: {detail.value}
                </Text>
              ),
            )}
            {test.data.notice && <Text size="xs">{diagnosticText(test.data.notice, t)}</Text>}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
};
