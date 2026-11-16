import { t, useLocale } from "./i18n";
import type { ReactNode } from "react";
import { Alert, Button, Group, Loader, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type { CommandCatalog } from "@mcp-cli/core";
import { useCommands } from "./queries";

// Session-discovery plugins show the bundled list until the server answers with its current tools.
export const useCommandCatalog = (
  service: string,
  enabled: boolean,
): { catalog?: CommandCatalog; status: ReactNode } => {
  const locale = useLocale();
  const bundled = useCommands(service, enabled);
  const live = useCommands(
    service,
    enabled && (bundled.data?.discovery === true || bundled.isError),
    true,
  );
  const catalog = live.data?.origin === "live" ? live.data : (bundled.data ?? live.data);
  const refresh = (
    <Button
      size="compact-xs"
      variant="subtle"
      leftSection={<IconRefresh size={14} />}
      loading={live.isFetching}
      onClick={() => void live.refetch()}
    >
      {t("다시 조회")}
    </Button>
  );
  if (!catalog)
    return {
      status:
        bundled.isPending || live.isFetching ? (
          <Loader size="sm" />
        ) : (
          <Alert color="red" title={t("명령 목록을 가져오지 못했습니다")}>
            {(live.error ?? bundled.error)?.message}
          </Alert>
        ),
    };
  if (catalog.origin === "live")
    return {
      catalog,
      status: (
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed">
            {t("서버에서 조회한 현재 도구 목록입니다.")}{" "}
            {catalog.fetchedAt && new Date(catalog.fetchedAt).toLocaleTimeString(locale)}
            {catalog.workspace && ` · ${catalog.workspace}`}
          </Text>
          {refresh}
        </Group>
      ),
    };
  if (catalog.origin === "static") return { catalog, status: null };
  return {
    catalog,
    status: live.error ? (
      <Alert color="yellow" title={t("현재 도구 목록을 조회하지 못해 번들 목록을 표시합니다")}>
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="sm" style={{ overflowWrap: "anywhere" }}>
            {live.error.message}
          </Text>
          {refresh}
        </Group>
      </Alert>
    ) : (
      <Group gap="xs">
        <Loader size={14} />
        <Text size="xs" c="dimmed">
          {t("서버에서 현재 도구 목록을 조회합니다. 그동안 번들 목록을 표시합니다.")}
        </Text>
      </Group>
    ),
  };
};
