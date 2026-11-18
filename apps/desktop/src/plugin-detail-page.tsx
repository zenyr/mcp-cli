import { t, useLocale } from "./i18n";
import { lazy, Suspense, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Code,
  Group,
  Loader,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { MarketplacePlugin } from "@mcp-cli/core";
import { usePlugins, useServices } from "./queries";
import { useCommandCatalog } from "./command-catalog";
import { ServiceIcon } from "./service-icon";
import { AuthBadge, PluginStateBadge } from "./plugin-badges";
import { ConsentModal, PluginActions, type Consent } from "./plugin-actions";
import { ServiceAuth } from "./service-auth";
import { CommandExplorer } from "./command-explorer";
import { isTab, type DetailSearch } from "./detail-search";

const CommandDiagram = lazy(() =>
  import("./command-diagram").then((module) => ({ default: module.CommandDiagram })),
);

const Overview = ({ plugin }: { plugin: MarketplacePlugin }) => {
  const permissions = plugin.installedPermissions ?? plugin.permissions;
  const rows: Array<[string, string]> = [
    [t("출처"), plugin.sourceName],
    [t("버전"), plugin.installedVersion ?? plugin.version],
    [t("네트워크"), permissions.network.join(", ") || t("선언 없음")],
    [t("파일 접근"), permissions.filesystem.join(", ") || t("선언 없음")],
    [t("로컬 코드 실행"), permissions.localCode ? t("예") : t("아니요")],
  ];
  return (
    <Stack gap="sm">
      <Table variant="vertical" withTableBorder layout="fixed">
        <Table.Tbody>
          {rows.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Th w={140}>{label}</Table.Th>
              <Table.Td style={{ overflowWrap: "anywhere" }}>{value}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {!plugin.supported && (
        <Alert color="gray">{t("이 운영체제와 CPU에 맞는 배포 파일이 없습니다.")}</Alert>
      )}
      {plugin.revoked && <Alert color="red">{plugin.revoked}</Alert>}
    </Stack>
  );
};

export const PluginDetailPage = () => {
  useLocale();
  const { service } = useParams({ from: "/plugins/$service" });
  const search = useSearch({ from: "/plugins/$service" });
  const navigate = useNavigate({ from: "/plugins/$service" });
  const [consent, setConsent] = useState<Consent>();
  const plugins = usePlugins();
  const services = useServices();
  const candidates = plugins.data?.plugins.filter((item) => item.service === service) ?? [];
  const plugin =
    candidates.find((item) => item.sourceId === search.source) ??
    candidates.find((item) => item.installed) ??
    candidates[0];
  const details = services.data?.find((item) => item.name === service);
  const active = Boolean(details) && (!plugin || plugin.enabled);
  const tab = search.tab ?? (plugin ? "overview" : "commands");
  const { catalog, status } = useCommandCatalog(
    service,
    active && (tab === "commands" || tab === "diagram"),
  );
  const path = search.path?.split(" ") ?? [];
  const go = (next: DetailSearch) =>
    void navigate({
      search: (previous) => ({ ...previous, ...next }),
      replace: next.tab === undefined,
      resetScroll: false,
    });
  const select = (next: string[]) => go({ tab: "commands", path: next.join(" ") || undefined });
  const loading = plugins.isPending || services.isPending;
  const inactive = (
    <Alert color="gray">{t("플러그인을 활성화하면 명령과 인증을 확인할 수 있습니다.")}</Alert>
  );
  const fill = active && (tab === "commands" || tab === "diagram");
  return (
    <Stack gap="md" className="plugin-detail" data-fill={fill || undefined}>
      <Anchor component={Link} to="/plugins" size="sm">
        <Group gap={2}>
          <IconChevronLeft size={14} />
          {t("플러그인")}
        </Group>
      </Anchor>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ServiceIcon service={service} />
          <Stack gap={3}>
            <Group gap="xs">
              <Title order={3}>{plugin?.name ?? service}</Title>
              {plugin ? (
                <PluginStateBadge plugin={plugin} />
              ) : (
                details && <Badge>{t("로컬")}</Badge>
              )}
              {details && <AuthBadge service={details} />}
            </Group>
            <Text size="sm">{plugin?.description ?? details?.summary}</Text>
            <Text size="xs" c="dimmed">
              {t("명령")} <Code>{service}</Code>
            </Text>
          </Stack>
        </Group>
        {plugin && <PluginActions plugin={plugin} onConsent={setConsent} />}
      </Group>
      {loading && <Loader size="sm" />}
      {!loading && !plugin && !details && (
        <Alert color="red">{t("플러그인을 찾을 수 없습니다: {service}", { service })}</Alert>
      )}
      {(plugin || details) && (
        <Tabs
          value={tab}
          onChange={(value) => isTab(value) && go({ tab: value })}
          keepMounted={false}
          className="fill-pane"
        >
          <Tabs.List>
            {plugin && <Tabs.Tab value="overview">{t("개요")}</Tabs.Tab>}
            <Tabs.Tab value="auth">{t("인증")}</Tabs.Tab>
            <Tabs.Tab value="commands">{t("명령")}</Tabs.Tab>
            <Tabs.Tab value="diagram">{t("구조도")}</Tabs.Tab>
          </Tabs.List>
          <Stack pt="md" className="fill-pane">
            {tab === "overview" && plugin && <Overview plugin={plugin} />}
            {tab === "auth" && (active && details ? <ServiceAuth service={details} /> : inactive)}
            {(tab === "commands" || tab === "diagram") && !active && inactive}
            {(tab === "commands" || tab === "diagram") && active && status}
            {tab === "commands" && active && catalog && (
              <CommandExplorer catalog={catalog} path={path} onSelect={select} />
            )}
            {tab === "diagram" && active && catalog && (
              <Suspense fallback={<Loader size="sm" />}>
                <CommandDiagram catalog={catalog} selected={path} onSelect={select} />
              </Suspense>
            )}
          </Stack>
        </Tabs>
      )}
      <ConsentModal consent={consent} onClose={() => setConsent(undefined)} />
    </Stack>
  );
};
