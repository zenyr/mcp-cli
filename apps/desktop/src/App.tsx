import { AppShell, Badge, NavLink, Stack, Text } from "@mantine/core";
import { IconKey, IconPlugConnected, IconSettings, IconPackage } from "@tabler/icons-react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useHotkeys } from "@mantine/hooks";
import { useStatus } from "./queries";
import { useInteractionSounds } from "./ui-sounds";
import { DaemonBar } from "./daemon-bar";

export const App = () => {
  useInteractionSounds();
  const location = useLocation();
  const navigate = useNavigate();
  const { data } = useStatus();
  const count = data?.online ? data.status.connections.length : 0;
  useHotkeys([
    [
      "mod+1",
      () => {
        void navigate({ to: "/connections" });
      },
    ],
    [
      "mod+2",
      () => {
        void navigate({ to: "/services" });
      },
    ],
    [
      "mod+3",
      () => {
        void navigate({ to: "/settings" });
      },
    ],
    ["mod+w", () => window.tiny?.win.hide()],
  ]);
  return (
    <AppShell header={{ height: 58 }} navbar={{ width: 168, breakpoint: 0 }} padding="lg">
      <AppShell.Header>
        <DaemonBar />
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <Text fw={700} size="sm" px="sm" pt="xs" pb="lg">
          MCP CLI
        </Text>
        <Stack gap={4}>
          <NavLink
            component={Link}
            to="/plugins"
            label="플러그인"
            leftSection={<IconPackage size={16} />}
            active={location.pathname === "/plugins"}
          />
          <NavLink
            component={Link}
            to="/connections"
            label="연결"
            leftSection={<IconPlugConnected size={16} />}
            rightSection={<Badge size="xs">{count}</Badge>}
            active={location.pathname === "/connections"}
          />
          <NavLink
            component={Link}
            to="/services"
            label="서비스"
            leftSection={<IconKey size={16} />}
            active={location.pathname === "/services"}
          />
          <NavLink
            component={Link}
            to="/settings"
            label="설정"
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
