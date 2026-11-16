import { useEffect, useRef } from "react";
import { call } from "./ipc";
import { t, useLocale } from "./i18n";
import { AppShell, Badge, NavLink, Stack, Text, useAppShellResize } from "@mantine/core";
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
  const [sidebarWidth, setSidebarWidth] = useLocalStorage({
    key: "mcp-cli.sidebar-width",
    defaultValue: 168,
  });
  const press = useRef<{ x: number; y: number; width: number; moved: boolean }>(undefined);
  const collapseIntent = useRef(!sidebarOpened);
  const expandedWidth = Math.max(168, sidebarWidth);
  const resize = useAppShellResize({
    navbar: { min: 168, max: 360, collapseThreshold: 120, label: t("사이드바 너비 조절") },
    initialSizes: { navbar: sidebarOpened ? expandedWidth : 8 },
    onCollapseChange: (_, collapsed) => {
      collapseIntent.current = collapsed;
    },
    onResize: ({ navbar }) => {
      if (press.current && navbar !== undefined && Math.abs(navbar - press.current.width) >= 4)
        press.current.moved = true;
    },
    onResizeEnd: ({ navbar }) => {
      if (navbar === undefined) return;
      const opened = !collapseIntent.current;
      setSidebarOpened(opened);
      if (opened) setSidebarWidth(navbar);
      else resize.navbar.setSize(8);
    },
  });
  const toggleSidebar = () => {
    collapseIntent.current = sidebarOpened;
    resize.navbar.setSize(sidebarOpened ? 8 : expandedWidth);
    setSidebarOpened(!sidebarOpened);
  };
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
        width: sidebarOpened ? expandedWidth : 8,
        breakpoint: 0,
      }}
      resize={resize}
      classNames={{ resizeHandle: "sidebar-resize-handle" }}
      padding="lg"
    >
      <AppShell.Header>
        <DaemonBar />
      </AppShell.Header>
      <AppShell.Navbar
        p={sidebarOpened ? "sm" : 0}
        onPointerDownCapture={(event) => {
          collapseIntent.current = !sidebarOpened;
          if (event.target instanceof Element && event.target.closest('[role="separator"]'))
            press.current = {
              x: event.clientX,
              y: event.clientY,
              width: event.currentTarget.getBoundingClientRect().width,
              moved: false,
            };
        }}
        onClickCapture={(event) => {
          const start = press.current;
          press.current = undefined;
          if (
            start &&
            !start.moved &&
            event.target instanceof Element &&
            event.target.closest('[role="separator"]') &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4
          )
            toggleSidebar();
        }}
        onKeyDownCapture={(event) => {
          collapseIntent.current = !sidebarOpened;
          if (
            (event.key === "Enter" || event.key === " ") &&
            event.target instanceof Element &&
            event.target.closest('[role="separator"]')
          ) {
            event.preventDefault();
            toggleSidebar();
          }
        }}
        onDoubleClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest('[role="separator"]'))
            event.stopPropagation();
        }}
      >
        <Stack
          gap={0}
          display={sidebarOpened ? undefined : "none"}
          miw={144}
          style={{ whiteSpace: "nowrap" }}
        >
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
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};
