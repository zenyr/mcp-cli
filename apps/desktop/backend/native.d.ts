declare interface DesktopApp {
  paths: { cache: string };
  spawnHidden(args: string[], options?: tjs.ProcessOptions): tjs.Process;
  playSound(path: string): Promise<boolean>;
  push(event: string, data?: unknown): void;
  show(): void;
  presence(mode: "normal" | "menubar"): void;
  getWinState(): Promise<{ visible: boolean; minimized: boolean }>;
  quit(): void;
  setHideOnClose(enabled: boolean): void;
  tray: {
    set(spec: {
      title?: string;
      icon?: string;
      template?: boolean;
      tooltip?: string;
      menu: ({ id: string; label: string } | { separator: true })[];
    }): void;
  };
  store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<boolean> };
}
