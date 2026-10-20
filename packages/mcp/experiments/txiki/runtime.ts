export type Child = {
  input: WritableStream<Uint8Array>;
  output: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};

export type Runtime = {
  name: "bun" | "txiki";
  args: string[];
  executable: string;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  spawn: (args: string[]) => Child;
  serve: (handler: (request: Request) => Response | Promise<Response>) => {
    url: string;
    close: () => Promise<void>;
  };
  read: (path: string) => Promise<string>;
  writePrivate: (path: string, value: string) => Promise<void>;
  input: ReadableStream<Uint8Array>;
  output: WritableStream<Uint8Array>;
  exit: (code: number) => never;
};
