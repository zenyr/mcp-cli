interface Window {
  tiny?: {
    api: {
      call(method: string, params?: unknown): Promise<unknown>;
      on(event: string, handler: (value: unknown) => void): () => void;
    };
    app: {
      shell: { open(url: string): Promise<boolean> };
      launchAtLogin: { get(): Promise<string>; set(enabled: boolean): Promise<string> };
    };
    clipboard: { write(data: { text: string }): Promise<unknown> };
    win: { hide(options?: { app: boolean }): void };
  };
}
