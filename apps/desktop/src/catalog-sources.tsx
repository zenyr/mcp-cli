import { t, useLocale } from "./i18n";
import { useState } from "react";
import { Button, Group, Paper, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { MarketplaceView } from "@mcp-cli/core";
import { useAction } from "./queries";

export const CatalogSources = ({ view }: { view: MarketplaceView | undefined }) => {
  useLocale();
  const action = useAction("pluginAction");
  const [repository, setRepository] = useState("");
  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        <Title order={4}>{t("카탈로그 저장소")}</Title>
        <Text size="sm">
          {t(
            "GitHub 또는 Forgejo의 HTTPS Git 주소를 추가하세요. 목록 갱신은 플러그인을 실행하지 않습니다.",
          )}
        </Text>
        <Group align="end">
          <TextInput
            style={{ flex: 1 }}
            label={t("저장소 주소")}
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
            {t("추가")}
          </Button>
        </Group>
        {view?.sources.map((source) => {
          const provided = view.plugins.filter((plugin) => plugin.sourceId === source.id);
          return (
            <Stack key={source.id} gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    {source.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {source.url === "builtin" ? t("앱에 포함된 카탈로그") : source.url} ·{" "}
                    {source.commit.slice(0, 8)}
                  </Text>
                </Stack>
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ type: "source.refresh", id: source.id })}
                  >
                    {t("목록 갱신")}
                  </Button>
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ type: "source.remove", id: source.id })}
                  >
                    {t("제거")}
                  </Button>
                </Group>
              </Group>
              {provided.length ? (
                <Stack
                  gap={0}
                  pl="sm"
                  style={{ borderLeft: "2px solid var(--mantine-color-default-border)" }}
                >
                  {provided.map((plugin) => (
                    <UnstyledButton
                      key={plugin.key}
                      renderRoot={(props) => (
                        <Link
                          {...props}
                          to="/plugins/$service"
                          params={{ service: plugin.service }}
                          search={{ source: plugin.sourceId }}
                        />
                      )}
                      className="catalog-entry"
                      px="xs"
                      py={4}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>
                          {plugin.name}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1 }}>
                          {plugin.description}
                        </Text>
                        <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed" pl="sm">
                  {t("이 카탈로그가 제공하는 플러그인이 없습니다.")}
                </Text>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
};
