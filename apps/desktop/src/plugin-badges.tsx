import { t, useLocale } from "./i18n";
import { Badge } from "@mantine/core";
import type { MarketplacePlugin } from "@mcp-cli/core";
import { workspaceRows, type Service } from "./ipc";

export const PluginStateBadge = ({ plugin }: { plugin: MarketplacePlugin }) => {
  useLocale();
  return (
    <Badge color={plugin.revoked ? "red" : plugin.enabled ? "teal" : "gray"}>
      {plugin.revoked
        ? t("차단됨")
        : plugin.enabled
          ? t("활성화됨")
          : plugin.installed
            ? t("비활성화됨")
            : t("설치 가능")}
    </Badge>
  );
};

// Every workspace needs one usable credential before the plugin counts as signed in.
export const AuthBadge = ({ service }: { service: Service }) => {
  useLocale();
  const rows = workspaceRows([service]);
  if (rows.some((row) => row.error))
    return (
      <Badge color="red" variant="light">
        {t("불러오기 실패")}
      </Badge>
    );
  if (service.auth === "none") return null;
  const ready = rows.every((row) =>
    row.credentials.some((credential) => credential.stored || credential.fromEnv),
  );
  return (
    <Badge color={ready ? "teal" : "orange"} variant="light">
      {ready ? t("인증됨") : t("로그인 필요")}
    </Badge>
  );
};
