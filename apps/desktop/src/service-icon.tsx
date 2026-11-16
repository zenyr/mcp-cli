import { t, useLocale } from "./i18n";
import { Box, Tooltip } from "@mantine/core";
import { IconPlug, IconRobot, IconUser } from "@tabler/icons-react";

const icons: Record<string, string> = {
  demo: new URL("../assets/mcp-cli.svg", import.meta.url).href,
  "fish-audio": new URL("../assets/services/fish-audio.svg", import.meta.url).href,
  linear: new URL("../assets/services/linear.svg", import.meta.url).href,
  notion: new URL("../assets/services/notion.svg", import.meta.url).href,
  slack: new URL("../assets/services/slack.svg", import.meta.url).href,
};

export const ServiceIcon = ({
  service,
  credential = "",
}: {
  service: string;
  credential?: string;
}) => {
  useLocale();
  const src = icons[service];
  const role = service === "slack" ? credential : "";
  const label = role === "xoxp" ? t("개인 토큰") : role === "xoxb" ? t("봇 토큰") : undefined;
  return (
    <Box className="service-icon">
      {src ? <img src={src} width={32} height={32} alt="" /> : <IconPlug size={32} aria-hidden />}
      {label && (
        <Tooltip label={label}>
          <span className="service-icon-role" role="img" aria-label={label}>
            {role === "xoxp" ? <IconUser size={12} /> : <IconRobot size={12} />}
          </span>
        </Tooltip>
      )}
    </Box>
  );
};
