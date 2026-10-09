import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, createTheme, MantineProvider, Table } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";

const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "sm",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSizes: { xs: "12px", sm: "13px", md: "14px" },
  components: {
    Button: Button.extend({ defaultProps: { size: "xs" } }),
    Badge: Badge.extend({ defaultProps: { size: "sm", variant: "light", radius: "sm" } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: "xs", fz: "sm" } }),
  },
});
const client = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, refetchIntervalInBackground: false } },
});
focusManager.setEventListener((handle) => {
  const update = () => handle(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", update);
  return () => document.removeEventListener("visibilitychange", update);
});
const element = document.getElementById("root");
if (!element) throw new Error("Root element is missing");
createRoot(element).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <QueryClientProvider client={client}>
        <ModalsProvider>
          <Notifications position="bottom-right" autoClose={3000} />
          <RouterProvider router={router} />
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
