import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from "@tanstack/react-router";
import { App } from "./App";
import { ConnectionsPage } from "./connections-page";
import { ServicesPage } from "./services-page";
import { SettingsPage } from "./settings-page";
const root = createRootRoute({ component: App });
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => <Navigate to="/services" />,
});
const connections = createRoute({
  getParentRoute: () => root,
  path: "/connections",
  component: ConnectionsPage,
});
const services = createRoute({
  getParentRoute: () => root,
  path: "/services",
  component: ServicesPage,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: SettingsPage,
});
export const router = createRouter({
  routeTree: root.addChildren([index, connections, services, settings]),
  history: createHashHistory(),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
