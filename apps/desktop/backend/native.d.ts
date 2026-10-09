declare interface DesktopApp {
  spawnHidden(args: string[], options?: tjs.ProcessOptions): tjs.Process;
  push(event: string, data?: unknown): void;
  show(): void;
  quit(): void;
  setHideOnClose(enabled: boolean): void;
  tray: {
    set(spec: {
      title?: string;
      icon?: string;
      tooltip?: string;
      menu: ({ id: string; label: string } | { separator: true })[];
    }): void;
  };
  store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<boolean> };
}
