import { t, useLocale } from "./i18n";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { MarketplaceAction, MarketplacePlugin } from "@mcp-cli/core";
import { useAction } from "./queries";

export type Consent = { plugin: MarketplacePlugin; operation: "install" | "enable" };

export const PluginActions = ({
  plugin,
  onConsent,
}: {
  plugin: MarketplacePlugin;
  onConsent: (consent: Consent) => void;
}) => {
  useLocale();
  const action = useAction("pluginAction");
  const run = (request: MarketplaceAction) => action.mutate(request);
  if (!plugin.installed)
    return (
      <Button
        disabled={!plugin.supported || action.isPending || Boolean(plugin.revoked)}
        onClick={() => onConsent({ plugin, operation: "install" })}
      >
        {t("설치")}
      </Button>
    );
  return (
    <Group gap="xs" wrap="nowrap">
      {plugin.updateAvailable && (
        <Button
          variant="default"
          disabled={!plugin.supported || action.isPending}
          onClick={() => onConsent({ plugin, operation: "install" })}
        >
          {t("업데이트")}
        </Button>
      )}
      <Button
        variant={plugin.enabled ? "default" : "filled"}
        disabled={action.isPending || Boolean(plugin.revoked)}
        onClick={() =>
          plugin.enabled
            ? run({ type: "plugin.enable", key: plugin.key, enabled: false })
            : onConsent({ plugin, operation: "enable" })
        }
      >
        {plugin.enabled ? t("비활성화") : t("활성화")}
      </Button>
      <Button
        color="red"
        variant="subtle"
        disabled={action.isPending}
        onClick={() => run({ type: "plugin.remove", key: plugin.key })}
      >
        {t("제거")}
      </Button>
    </Group>
  );
};

export const ConsentModal = ({
  consent,
  onClose,
}: {
  consent: Consent | undefined;
  onClose: () => void;
}) => {
  useLocale();
  const action = useAction("pluginAction");
  const permissions =
    consent?.operation === "enable"
      ? (consent.plugin.installedPermissions ?? consent.plugin.permissions)
      : consent?.plugin.permissions;
  return (
    <Modal
      opened={Boolean(consent)}
      onClose={() => {
        if (!action.isPending) onClose();
      }}
      title={`${consent?.plugin.name ?? ""} ${consent?.operation === "install" ? t("설치") : t("활성화")}`}
      centered
    >
      {consent && permissions && (
        <Stack>
          <Text size="sm">
            {t("출처:")}
            {consent.plugin.sourceName}
          </Text>
          <Text size="sm">
            {t("네트워크:")}
            {permissions.network.join(", ") || t("선언 없음")}
          </Text>
          <Text size="sm">
            {t("파일 접근:")}
            {permissions.filesystem.join(", ") || t("선언 없음")}
          </Text>
          {permissions.localCode && (
            <Alert color="yellow">
              {t(
                "활성화하면 다운로드한 플러그인을 이 컴퓨터에서 사용자 계정 권한으로 실행합니다. 파일과 네트워크 접근을 운영체제 샌드박스로 제한하지 않습니다.",
              )}
            </Alert>
          )}
          {consent.operation === "install" && (
            <Text size="sm">
              {t("동의하면 플러그인을 다운로드하고 검증한 뒤 바로 활성화합니다.")}
            </Text>
          )}
          <Button
            loading={action.isPending}
            onClick={() => {
              const request: MarketplaceAction =
                consent.operation === "install"
                  ? {
                      type: "plugin.install",
                      sourceId: consent.plugin.sourceId,
                      pluginId: consent.plugin.id,
                      enable: true,
                      allowLocalCode: permissions.localCode,
                    }
                  : {
                      type: "plugin.enable",
                      key: consent.plugin.key,
                      enabled: true,
                      allowLocalCode: permissions.localCode,
                    };
              action.mutate(request, { onSuccess: onClose });
            }}
          >
            {consent.operation === "install" ? t("동의하고 설치") : t("동의하고 활성화")}
          </Button>
        </Stack>
      )}
    </Modal>
  );
};
