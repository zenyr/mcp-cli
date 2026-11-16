import { t, useLocale } from "./i18n";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { MarketplacePlugin } from "@mcp-cli/core";
import { useAction, usePlugins, useServices } from "./queries";
import type { Service } from "./ipc";
import { ServiceIcon } from "./service-icon";
import { AuthBadge, PluginStateBadge } from "./plugin-badges";
import { ConsentModal, PluginActions, type Consent } from "./plugin-actions";
import { CatalogSources } from "./catalog-sources";

const PluginCard = ({
  service,
  plugin,
  details,
  onConsent,
}: {
  service: string;
  plugin?: MarketplacePlugin;
  details?: Service;
  onConsent: (consent: Consent) => void;
}) => {
  const link = (tab?: "commands") => (props: Record<string, unknown>) => (
    <Link
      {...props}
      to="/plugins/$service"
      params={{ service }}
      search={{ ...(plugin && { source: plugin.sourceId }), ...(tab && { tab }) }}
    />
  );
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <UnstyledButton renderRoot={link()} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <ServiceIcon service={service} />
              <Stack gap={3} style={{ minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600}>{plugin?.name ?? service}</Text>
                  {plugin ? <PluginStateBadge plugin={plugin} /> : <Badge>{t("로컬")}</Badge>}
                  {plugin?.development && <Badge variant="outline">{t("개발")}</Badge>}
                  {details && <AuthBadge service={details} />}
                </Group>
                <Text size="sm">{plugin?.description ?? details?.summary}</Text>
                <Text size="xs" c="dimmed">
                  {plugin
                    ? `${plugin.sourceName} · ${plugin.installedVersion ?? plugin.version} · `
                    : ""}
                  {t("명령")} <Code>{service}</Code>
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
          <Group gap="xs" wrap="nowrap">
            {details && (
              <Button
                renderRoot={link("commands")}
                variant="subtle"
                leftSection={<IconHelpCircle size={16} />}
              >
                {t("도움말")}
              </Button>
            )}
            {plugin && <PluginActions plugin={plugin} onConsent={onConsent} />}
          </Group>
        </Group>
        {plugin && !plugin.supported && (
          <Text size="sm" c="dimmed">
            {t("이 운영체제와 CPU에 맞는 배포 파일이 없습니다.")}
          </Text>
        )}
        {plugin?.revoked && <Alert color="red">{plugin.revoked}</Alert>}
      </Stack>
    </Paper>
  );
};

export const PluginsPage = () => {
  useLocale();
  const { data, error, isPending } = usePlugins();
  const services = useServices();
  const action = useAction("pluginAction");
  const [directory, setDirectory] = useState("");
  const [consent, setConsent] = useState<Consent>();
  const loaded = services.data ?? [];
  const local = loaded.filter(
    (service) => !data?.plugins.some((plugin) => plugin.service === service.name),
  );
  const detailsFor = (plugin: MarketplacePlugin) =>
    plugin.enabled ? loaded.find((service) => service.name === plugin.service) : undefined;
  return (
    <Stack gap="lg">
      <Title order={3}>{t("플러그인")}</Title>
      {error && <Alert color="red">{error.message}</Alert>}
      {services.error && <Alert color="red">{services.error.message}</Alert>}
      {action.data && <Alert color="teal">{action.data.message}</Alert>}
      {isPending && <Text>{t("플러그인 목록을 확인합니다.")}</Text>}
      {data && !data.sources.length && !data.plugins.length && (
        <Alert color="gray">
          {t("등록한 카탈로그가 없습니다. 추천 목록에서 선택하거나 저장소 주소를 추가하세요.")}
        </Alert>
      )}
      {data &&
        data.recommendations.some(
          (item) => !data.sources.some((source) => source.id === item.id),
        ) && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Title order={4}>{t("추천 카탈로그")}</Title>
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
                      onClick={() => action.mutate({ type: "source.add", url: item.url })}
                    >
                      {t("불러오기")}
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
              <Text fw={600}>{t("터미널 명령")}</Text>
              <Badge color={data.onPath ? "teal" : "gray"}>
                {data.onPath ? t("PATH 등록됨") : t("PATH 설정 확인")}
              </Badge>
            </Group>
            <Text size="sm">
              {t("명령 폴더")} <Code>{data.commandDirectory}</Code>
            </Text>
            <Group>
              <Button
                variant="default"
                loading={action.isPending}
                onClick={() => action.mutate({ type: "commands.install" })}
              >
                {t("PATH에 등록")}
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              {t("등록 후 새 터미널을 열어 주세요. 기존 명령 파일은 덮어쓰지 않습니다.")}
            </Text>
          </Stack>
        </Paper>
      )}
      {data?.plugins.map((plugin) => (
        <PluginCard
          key={plugin.key}
          service={plugin.service}
          plugin={plugin}
          details={detailsFor(plugin)}
          onConsent={setConsent}
        />
      ))}
      {local.map((service) => (
        <PluginCard
          key={service.name}
          service={service.name}
          details={service}
          onConsent={setConsent}
        />
      ))}
      <CatalogSources view={data} />
      <details>
        <summary>{t("플러그인 개발")}</summary>
        <Stack mt="sm">
          <Text size="sm">
            {t(
              "plugin.json과 manifest.json이 있는 로컬 폴더를 연결합니다. 개발 폴더의 코드는 다음 실행에 반영됩니다.",
            )}
          </Text>
          <Group align="end">
            <TextInput
              style={{ flex: 1 }}
              label={t("개발 폴더의 절대 경로")}
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
              {t("연결")}
            </Button>
          </Group>
        </Stack>
      </details>
      <ConsentModal consent={consent} onClose={() => setConsent(undefined)} />
    </Stack>
  );
};
