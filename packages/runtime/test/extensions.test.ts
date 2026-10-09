import { expect, test } from "bun:test";
import {
  RepeatedCallError,
  UsageError,
  type CallRecord,
  type ExtensionCommand,
  type RepeatGuard,
  type ServicePlugin,
  type ToolCaller,
  type ToolResult,
  type ToolSession,
} from "@mcp-cli/core";
import { runService, type RuntimeDependencies } from "../src";
import { catalogStub, commands, manifest } from "./fixtures/manifest";

const result: ToolResult = {
  content: [{ type: "text", text: "done" }],
  structuredContent: { count: 1 },
};
const workflow = (
  run: ExtensionCommand["run"] = async (input, context) => ({
    result: await context.callTool("demo-echo", input),
  }),
): ExtensionCommand => ({
  path: ["flow", "run"],
  kind: "workflow",
  summary: "Run workflow",
  details: "Workflow details",
  examples: ["demo flow run --text hello"],
  inputSchema: manifest.tools[0].inputSchema,
  run,
});
const plugin = (extension = workflow()): ServicePlugin => ({
  name: "demo",
  summary: "Demo",
  commands,
  connection: () => {
    throw new Error("Use fake ports");
  },
  auth: {
    type: "apiKey",
    env: "KEY",
    alternates: [{ flag: "bot", env: "BOT_KEY", summary: "Bot" }],
  },
  extensions: {
    commands: [extension, { ...workflow(), path: ["shortcut"], kind: "alias", tool: "demo-echo" }],
  },
});
const fixture = (call: ToolCaller = async () => result) => {
  const output: string[] = [],
    errors: string[] = [],
    events: string[] = [];
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const credentials: Array<string | undefined> = [];
  const records = new Map<string, CallRecord>();
  const finishes: string[] = [];
  const guard: RepeatGuard = {
    begin: async (_service, key, tool, attempt) => {
      events.push(`guard:${tool}`);
      const earlier = records.get(key);
      if (earlier && earlier.status !== "error") return earlier;
      records.set(key, { tool, attempt, status: "pending", at: Date.now() });
      return undefined;
    },
    finish: async (_service, key, attempt, status) => {
      const record = records.get(key);
      if (record?.attempt === attempt) records.set(key, { ...record, status });
      finishes.push(status);
    },
  };
  const session: ToolSession = {
    ...catalogStub,
    listTools: async () => {
      throw new Error("No discovery");
    },
    callTool: async (name, input) => {
      events.push(`call:${name}`);
      calls.push({ name, input });
      return call(name, input);
    },
    close: async () => {
      events.push("close");
    },
  };
  const dependencies: RuntimeDependencies = {
    guard,
    open: async (credential) => {
      credentials.push(credential);
      events.push("open");
      return session;
    },
    putBytes: async () => {
      events.push("put");
    },
    io: {
      write: (text) => output.push(text),
      writeError: (text) => errors.push(text),
      readFile: async () => "{}",
      readStdin: async () => "{}",
      readBytes: async () => new Uint8Array([1, 2]),
    },
  };
  return { output, errors, events, calls, credentials, records, finishes, dependencies };
};
const args = ["flow", "run", "--text", "hello"];

test("extension help and typed methods remain offline", async () => {
  const f = fixture();
  for (const argv of [
    ["--help"],
    ["flow", "--help"],
    ["help", "flow", "run"],
    ["shortcut", "--help"],
  ])
    expect(await runService(plugin(), manifest, argv, f.dependencies)).toBe(0);
  expect(f.output[2]).toContain("--text");
  expect(f.output[2]).toContain("Workflow details");
  await runService(plugin(), manifest, ["methods", "--json"], f.dependencies);
  expect(JSON.parse(f.output.at(-1) ?? "[]")).toEqual(
    expect.arrayContaining([
      { path: ["flow", "run"], kind: "workflow", summary: "Run workflow" },
      { path: ["shortcut"], kind: "alias", tool: "demo-echo", summary: "Run workflow" },
    ]),
  );
  await runService(plugin(), manifest, ["methods", "flow", "--json"], f.dependencies);
  expect(JSON.parse(f.output.at(-1) ?? "[]")).toHaveLength(1);
  expect(f.events).toEqual([]);
});

test("raw call cannot dispatch a workflow", async () => {
  let ran = false;
  const p = plugin(
    workflow(async () => {
      ran = true;
      return { result };
    }),
  );
  const f = fixture();
  await expect(
    runService(p, manifest, ["call", "flow", "run", "--text", "hello"], f.dependencies),
  ).rejects.toBeInstanceOf(UsageError);
  expect(ran).toBe(false);
  expect(f.events).toEqual([]);
});

test("extension and nested schema rejection precede connection and guard", async () => {
  const f = fixture();
  let ran = false;
  await expect(
    runService(
      plugin(
        workflow(async () => {
          ran = true;
          return { result };
        }),
      ),
      manifest,
      ["flow", "run"],
      f.dependencies,
    ),
  ).rejects.toBeInstanceOf(UsageError);
  expect(ran).toBe(false);
  await expect(
    runService(
      plugin(
        workflow(async (_input, context) => ({
          result: await context.callTool("demo-echo", { text: "ok", count: 99 }),
        })),
      ),
      manifest,
      args,
      f.dependencies,
    ),
  ).rejects.toBeInstanceOf(UsageError);
  expect(f.events).toEqual([]);
});

test("beforeCall rejection blocks mapped, raw, alias and workflow calls before connection", async () => {
  for (const path of [["message", "echo"], ["call", "demo-echo"], ["shortcut"], ["flow", "run"]]) {
    const f = fixture();
    const p = plugin();
    const checked: string[] = [];
    p.beforeCall = async (command) => {
      checked.push(command.name);
      throw new UsageError("Policy rejected");
    };
    await expect(
      runService(p, manifest, [...path, "--text", "hello"], f.dependencies),
    ).rejects.toBeInstanceOf(UsageError);
    expect(checked).toEqual(["demo-echo"]);
    expect(f.events).toEqual([]);
  }
});

test("nested calls cannot address extension names or unknown tools", async () => {
  for (const name of ["flow run", "shortcut", "missing"]) {
    const f = fixture();
    await expect(
      runService(
        plugin(workflow(async (_input, context) => ({ result: await context.callTool(name, {}) }))),
        manifest,
        args,
        f.dependencies,
      ),
    ).rejects.toBeInstanceOf(UsageError);
    expect(f.events).toEqual([]);
  }
});

test("workflow guard settles success and server errors but keeps uncertain throws pending", async () => {
  for (const outcome of ["ok", "error", "throw"] as const) {
    const f = fixture(async () => {
      if (outcome === "throw") throw new Error("Disconnected");
      return { ...result, isError: outcome === "error" };
    });
    if (outcome === "throw")
      await expect(runService(plugin(), manifest, args, f.dependencies)).rejects.toThrow(
        "Disconnected",
      );
    else
      expect(await runService(plugin(), manifest, args, f.dependencies)).toBe(
        outcome === "ok" ? 0 : 1,
      );
    expect([...f.records.values()].map(({ status }) => status)).toEqual([
      outcome === "throw" ? "pending" : outcome,
    ]);
    expect(f.events.at(-1)).toBe("close");
    if (outcome === "error") {
      expect(await runService(plugin(), manifest, args, f.dependencies)).toBe(1);
      expect(f.calls).toHaveLength(2);
    } else {
      await expect(runService(plugin(), manifest, args, f.dependencies)).rejects.toBeInstanceOf(
        RepeatedCallError,
      );
      expect(f.calls).toHaveLength(1);
    }
  }
});

test("workflow cannot silently repeat a call and explicit allow-repeat preserves policy", async () => {
  const twice = plugin(
    workflow(async (input, context) => {
      await context.callTool("demo-echo", input);
      return { result: await context.callTool("demo-echo", input) };
    }),
  );
  const f = fixture();
  await expect(runService(twice, manifest, args, f.dependencies)).rejects.toBeInstanceOf(
    RepeatedCallError,
  );
  expect(f.calls).toHaveLength(1);
  const allowed = fixture();
  const checked: string[] = [];
  twice.beforeCall = async (command) => {
    checked.push(command.name);
  };
  expect(await runService(twice, manifest, [...args, "--allow-repeat"], allowed.dependencies)).toBe(
    0,
  );
  expect(allowed.calls).toHaveLength(2);
  expect(checked).toEqual(["demo-echo", "demo-echo"]);
  expect(allowed.records.size).toBe(0);
  twice.beforeCall = async () => {
    throw new UsageError("Policy rejected");
  };
  const denied = fixture();
  await expect(
    runService(twice, manifest, [...args, "--allow-repeat"], denied.dependencies),
  ).rejects.toBeInstanceOf(UsageError);
  expect(denied.events).toEqual([]);
});

test("concurrent awaited workflow calls share chosen credential and close after both finish", async () => {
  const first = Promise.withResolvers<ToolResult>();
  const second = Promise.withResolvers<ToolResult>();
  const started = Promise.withResolvers<void>();
  let count = 0;
  const f = fixture(async (_name, input) => {
    if (++count === 2) started.resolve();
    return input.text === "first" ? first.promise : second.promise;
  });
  const p = plugin(
    workflow(async (_input, context) => {
      const results = await Promise.all([
        context.callTool("demo-echo", { text: "first" }),
        context.callTool("demo-echo", { text: "second" }),
      ]);
      expect(f.events).not.toContain("close");
      return { result: results[0] ?? result };
    }),
  );
  const running = runService(p, manifest, [...args, "--bot"], f.dependencies);
  await started.promise;
  expect(f.credentials).toEqual(["bot"]);
  expect(f.events).not.toContain("close");
  first.resolve(result);
  await first.promise;
  expect(f.events).not.toContain("close");
  second.resolve(result);
  expect(await running).toBe(0);
  expect(f.events.filter((event) => event === "close")).toHaveLength(1);
});

test("local-only workflows never open a connection and preserve explicit exit codes", async () => {
  const f = fixture();
  expect(
    await runService(
      plugin(workflow(async () => ({ result, exitCode: 7 }))),
      manifest,
      [...args, "--json"],
      f.dependencies,
    ),
  ).toBe(7);
  expect(JSON.parse(f.output[0] ?? "{}")).toEqual(result);
  expect(f.events).toEqual([]);
});

test("mapped raw alias and workflow preserve result content and default exit codes", async () => {
  for (const path of [["message", "echo"], ["call", "demo-echo"], ["shortcut"], ["flow", "run"]])
    for (const isError of [false, true])
      for (const json of [false, true]) {
        const response = { ...result, isError };
        const f = fixture(async () => response);
        expect(
          await runService(
            plugin(),
            manifest,
            [...path, "--text", "hello", ...(json ? ["--json"] : [])],
            f.dependencies,
          ),
        ).toBe(isError ? 1 : 0);
        expect(f.calls).toEqual([{ name: "demo-echo", input: { text: "hello" } }]);
        if (json) expect(JSON.parse(f.output[0] ?? "{}")).toEqual(response);
        else expect(isError ? f.errors : f.output).toEqual(["done"]);
        expect(f.events.at(-1)).toBe("close");
      }
});

test("upload slot calls use nested validation policy and repeat guard", async () => {
  const generated = {
    ...manifest,
    tools: [
      ...manifest.tools,
      {
        name: "get_upload_url",
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
          additionalProperties: false,
        },
      },
      {
        name: "send_file",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: { url: { type: "string", pattern: "^https://" } },
        },
      },
    ],
  };
  for (const mode of ["ok", "schema", "policy", "repeat"] as const) {
    const f = fixture();
    const checked: string[] = [];
    const p = plugin(
      workflow(async (_input, context) => ({
        result: await context.callTool("send_file", { url: "@voice.wav" }),
      })),
    );
    p.commands = { ...commands, send_file: { path: ["file", "send"], uploads: ["url"] } };
    p.beforeCall = async (command) => {
      checked.push(command.name);
      if (mode === "policy" && command.name === "get_upload_url")
        throw new UsageError("Slot rejected");
    };
    p.uploadFile = async (file, context) => {
      await context.callTool("get_upload_url", mode === "schema" ? {} : { name: file.name });
      if (mode === "repeat") await context.callTool("get_upload_url", { name: file.name });
      await context.putBytes("https://upload.example/file", file.bytes);
      return "https://cdn.example/file";
    };
    if (mode === "ok") {
      expect(await runService(p, generated, args, f.dependencies)).toBe(0);
      expect(checked).toEqual(["send_file", "get_upload_url"]);
      expect(f.calls).toEqual([
        { name: "get_upload_url", input: { name: "voice.wav" } },
        { name: "send_file", input: { url: "https://cdn.example/file" } },
      ]);
      expect(f.finishes).toEqual(["ok", "ok"]);
      expect(f.credentials).toHaveLength(1);
    } else {
      await expect(runService(p, generated, args, f.dependencies)).rejects.toBeInstanceOf(
        mode === "repeat" ? RepeatedCallError : UsageError,
      );
      expect(f.calls.map(({ name }) => name)).toEqual(mode === "repeat" ? ["get_upload_url"] : []);
      expect(f.events).not.toContain("put");
      expect([...f.records.values()].find(({ tool }) => tool === "send_file")?.status).toBe(
        "error",
      );
    }
    expect(f.events.at(-1)).toBe("close");
  }
});

test("connection failure settles nested attempt as error and permits retry", async () => {
  const f = fixture();
  f.dependencies.open = async () => {
    throw new Error("Connection failed");
  };
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(runService(plugin(), manifest, args, f.dependencies)).rejects.toThrow(
      "Connection failed",
    );
  expect(f.finishes).toEqual(["error", "error"]);
  expect(f.calls).toEqual([]);
});

test("repeat keys are shared across entry points and scoped to chosen credentials", async () => {
  const f = fixture();
  expect(await runService(plugin(), manifest, args, f.dependencies)).toBe(0);
  for (const path of [["message", "echo"], ["call", "demo-echo"], ["shortcut"]])
    await expect(
      runService(plugin(), manifest, [...path, "--text", "hello"], f.dependencies),
    ).rejects.toBeInstanceOf(RepeatedCallError);
  expect(await runService(plugin(), manifest, [...args, "--bot"], f.dependencies)).toBe(0);
  expect(f.credentials).toEqual([undefined, "bot"]);
  expect(f.records.size).toBe(2);
});

test("nested read-only and idempotent tools keep their repeat exemptions", async () => {
  for (const annotations of [{ readOnlyHint: true }, { idempotentHint: true }]) {
    const generated = {
      ...manifest,
      tools: manifest.tools.map((tool) => ({ ...tool, annotations })),
    };
    const f = fixture();
    const p = plugin(
      workflow(async (input, context) => {
        await context.callTool("demo-echo", input);
        return { result: await context.callTool("demo-echo", input) };
      }),
    );
    expect(await runService(p, generated, args, f.dependencies)).toBe(0);
    expect(f.calls).toHaveLength(2);
    expect(f.records.size).toBe(0);
  }
});

test("upload slots remain guarded within one attempt but do not collide across files or failed transfers", async () => {
  const generated = {
    ...manifest,
    tools: [
      ...manifest.tools,
      {
        name: "slot",
        inputSchema: {
          type: "object",
          properties: { filename: { type: "string" } },
          required: ["filename"],
        },
      },
      {
        name: "send",
        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      },
    ],
  };
  const f = fixture();
  const p = plugin();
  p.commands = { ...commands, send: { path: ["send"], uploads: ["url"] } };
  p.uploadFile = async (file, context) => {
    await context.callTool("slot", { filename: file.name });
    await context.putBytes("https://upload.test/file", file.bytes);
    return "https://cdn.test/file";
  };
  f.dependencies.io.readBytes = async (path) => new Uint8Array(path.startsWith("a/") ? [1] : [2]);
  await runService(p, generated, ["send", "--url", "@a/clip.wav"], f.dependencies);
  let fail = true;
  f.dependencies.putBytes = async () => {
    if (fail) throw new Error("transfer failed");
  };
  await expect(
    runService(p, generated, ["send", "--url", "@b/clip.wav"], f.dependencies),
  ).rejects.toThrow("transfer failed");
  fail = false;
  await runService(p, generated, ["send", "--url", "@b/clip.wav"], f.dependencies);
  expect(f.calls.filter((call) => call.name === "send")).toHaveLength(2);
  expect(f.calls.filter((call) => call.name === "slot")).toHaveLength(3);
});
