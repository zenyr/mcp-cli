import { useEffect } from "react";
import { call } from "./ipc";
import { t, useLocale } from "./i18n";
import { AppShell, Badge, NavLink, Stack, Text } from "@mantine/core";
import { IconPlugConnected, IconSettings, IconPackage } from "@tabler/icons-react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useHotkeys, useLocalStorage } from "@mantine/hooks";
import { useStatus } from "./queries";
import { useInteractionSounds } from "./ui-sounds";
import { DaemonBar } from "./daemon-bar";

export const App = () => {
  const [sidebarOpened, setSidebarOpened] = useLocalStorage({
    key: "mcp-cli.sidebar-opened",
    defaultValue: true,
  });
  const locale = useLocale();
  useEffect(() => {
    void call("setLocale", { locale }).catch(() => undefined);
  }, [locale]);
  useInteractionSounds();
  const location = useLocation();
  const navigate = useNavigate();
  const { data } = useStatus();
  const count = data?.online ? data.status.connections.length : 0;
  useHotkeys([
    [
      "mod+1",
      () => {
        void navigate({ to: "/plugins" });
      },
    ],
    [
      "mod+2",
      () => {
        void navigate({ to: "/connections" });
      },
    ],
    [
      "mod+3",
      () => {
        void navigate({ to: "/settings" });
      },
    ],
    ["mod+w", () => window.tiny?.win.hide({ app: false })],
  ]);
  return (
    <AppShell
      header={{ height: 58 }}
      navbar={{
        width: 168,
        breakpoint: 0,
        collapsed: { desktop: !sidebarOpened, mobile: !sidebarOpened },
      }}
      padding="lg"
    >
      <AppShell.Header>
        <DaemonBar
          sidebarOpened={sidebarOpened}
          onToggleSidebar={() => setSidebarOpened((opened) => !opened)}
        />
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <Text fw={700} size="sm" px="sm" pt="xs" pb="lg">
          MCP CLI
        </Text>
        <Stack gap={4}>
          <NavLink
            component={Link}
            to="/plugins"
            label={t("플러그인")}
            leftSection={<IconPackage size={16} />}
            active={location.pathname.startsWith("/plugins")}
          />
          <NavLink
            component={Link}
            to="/connections"
            label={t("연결")}
            leftSection={<IconPlugConnected size={16} />}
            rightSection={<Badge size="xs">{count}</Badge>}
            active={location.pathname === "/connections"}
          />
          <NavLink
            component={Link}
            to="/settings"
            label={t("설정")}
            leftSection={<IconSettings size={16} />}
            active={location.pathname === "/settings"}
          />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};
