interface WindowPresenceApp {
  presence(mode: "normal" | "menubar"): void;
  show(): void;
  getWinState(): Promise<{ visible: boolean; minimized: boolean }>;
}

let current: "normal" | "menubar" = "menubar";
let checking = false;
let revision = 0;

export const showManagementWindow = (app: WindowPresenceApp) => {
  revision += 1;
  current = "normal";
  app.presence(current);
  app.show();
};

export const syncWindowPresence = async (app: WindowPresenceApp) => {
  if (checking) return;
  checking = true;
  const started = revision;
  try {
    const state = await app.getWinState();
    if (started !== revision) return;
    const next = state.visible || state.minimized ? "normal" : "menubar";
    if (next !== current) {
      current = next;
      app.presence(next);
    }
  } catch (error) {
    console.error("Failed to synchronize window presence", error);
  } finally {
    checking = false;
  }
};
