import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from "@tanstack/react-router";
import { App } from "./App";
import { ConnectionsPage } from "./connections-page";
import { SettingsPage } from "./settings-page";
import { PluginsPage } from "./plugins-page";
import { PluginDetailPage } from "./plugin-detail-page";
import { parseDetailSearch } from "./detail-search";
const root = createRootRoute({ component: App });
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => <Navigate to="/plugins" />,
});
const connections = createRoute({
  getParentRoute: () => root,
  path: "/connections",
  component: ConnectionsPage,
});
const services = createRoute({
  getParentRoute: () => root,
  path: "/services",
  component: () => <Navigate to="/plugins" />,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: SettingsPage,
});
const plugins = createRoute({
  getParentRoute: () => root,
  path: "/plugins",
  component: PluginsPage,
});
export const pluginDetail = createRoute({
  getParentRoute: () => root,
  path: "/plugins/$service",
  validateSearch: parseDetailSearch,
  component: PluginDetailPage,
});
export const router = createRouter({
  routeTree: root.addChildren([index, connections, services, settings, plugins, pluginDetail]),
  history: createHashHistory(),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
