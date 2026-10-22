import { expect, test } from "bun:test";
import {
  RepeatedCallError,
  UsageError,
  definePlugin,
  isRecord,
  type CallRecord,
  type RepeatGuard,
  type ToolSession,
} from "@mcp-cli/core";
import { SchemaCompileError } from "@mcp-cli/schema";
import { runService } from "../src";
import { catalogStub, commands, manifest } from "./fixtures/manifest";

const plugin = definePlugin({
  name: "demo",
  summary: "Demo",
  commands,
  connection: () => ({ type: "stdio", command: "unused" }),
});
const files: Record<string, number[]> = { "a.wav": [1, 2], "b.wav": [3], "copy.wav": [1, 2] };
const fixture = (error = false) => {
  const output: string[] = [];
  const errors: string[] = [];
  const calls: unknown[] = [];
  let opened = 0;
  let closed = 0;
  const session: ToolSession = {
    ...catalogStub,
    listTools: async () => {
      throw new Error("Runtime must not discover tools");
    },
    callTool: async (name, input) => {
      calls.push({ name, input });
      return { content: [{ type: "text", text: "hello" }], isError: error };
    },
    close: async () => {
      closed++;
    },
  };
  const dependencies = {
    open: async () => {
      opened++;
      return session;
    },
    io: {
      write: (text: string) => output.push(text),
      writeError: (text: string) => errors.push(text),
      readFile: async () => '{"text":"file"}',
      readStdin: async () => '{"text":"stdin"}',
      readBytes: async (path: string) => {
        const bytes = files[path];
        if (!bytes) throw new Error(`ENOENT ${path}`);
        return new Uint8Array(bytes);
      },
    },
  };
  return { output, errors, calls, dependencies, counts: () => ({ opened, closed }) };
};
test("progressive help and discovery never open a connection", async () => {
  const f = fixture();
  for (const args of [
    [],
    ["--help"],
    ["message"],
    ["help", "message", "echo"],
    ["message", "echo", "--help"],
    ["call", "demo-echo", "--help"],
    ["methods", "message", "--json"],
    ["skill"],
  ]) {
    expect(await runService(plugin, manifest, args, f.dependencies)).toBe(0);
  }
  expect(f.counts()).toEqual({ opened: 0, closed: 0 });
  expect(f.output[0]).not.toContain("--text");
  expect(f.output[2]).not.toContain("--text");
  expect(f.output[3]).toContain("--text  string (required)");
  expect(JSON.parse(f.output[6] ?? "[]")).toHaveLength(2);
});
test("schema-driven flags preserve strings and map nested fields", async () => {
  const f = fixture();
  await runService(
    plugin,
    manifest,
    [
      "message",
      "echo",
      "--text",
      "001",
      "--count",
      "2",
      "--no-uppercase",
      "--labels",
      '["x"]',
      "--parent.page-id",
      "123",
    ],
    f.dependencies,
  );
  expect(f.calls).toEqual([
    {
      name: "demo-echo",
      input: { text: "001", count: 2, uppercase: false, labels: ["x"], parent: { page_id: "123" } },
    },
  ]);
  expect(f.counts()).toEqual({ opened: 1, closed: 1 });
});
test("raw calls use the same validation as mapped commands", async () => {
  const f = fixture();
  for (const args of [
    ["message", "echo"],
    ["call", "demo-echo", "--input", '{"text":"ok","count":99}'],
    ["message", "echo", "--text", "ok", "--unknown", "x"],
  ]) {
    await expect(runService(plugin, manifest, args, f.dependencies)).rejects.toBeInstanceOf(
      UsageError,
    );
  }
  expect(f.counts().opened).toBe(0);
});
test("JSON, stdin and file input support the same tool", async () => {
  const f = fixture();
  for (const args of [
    ["--input", '{"text":"json"}'],
    ["--input", "-"],
    ["--input-file", "input.json"],
  ]) {
    await runService(plugin, manifest, ["call", "demo-echo", ...args, "--json"], f.dependencies);
  }
  expect(f.calls).toEqual(
    ["json", "stdin", "file"].map((text) => ({ name: "demo-echo", input: { text } })),
  );
  expect(f.counts()).toEqual({ opened: 3, closed: 3 });
});
test("invalid flags and prototype paths fail before opening", async () => {
  for (const args of [
    ["--text"],
    ["--text", "a", "--text", "b"],
    ["--input", "[]"],
    ["--input", "{}", "--text", "x"],
    ["--__proto__.polluted", "yes"],
    ["--no-text"],
  ]) {
    const f = fixture();
    await expect(
      runService(plugin, manifest, ["message", "echo", ...args], f.dependencies),
    ).rejects.toBeInstanceOf(UsageError);
    expect(f.counts().opened).toBe(0);
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
test("tool errors write text to the error channel, return nonzero and close the session", async () => {
  const f = fixture(true);
  expect(await runService(plugin, manifest, ["message", "fail"], f.dependencies)).toBe(1);
  expect(f.output).toEqual([]);
  expect(f.errors).toEqual(["hello"]);
  expect(f.counts()).toEqual({ opened: 1, closed: 1 });
});
test("tool errors with --json keep the structured result on stdout", async () => {
  const f = fixture(true);
  expect(await runService(plugin, manifest, ["message", "fail", "--json"], f.dependencies)).toBe(1);
  expect(f.errors).toEqual([]);
  expect(JSON.parse(f.output.join(""))).toEqual({
    content: [{ type: "text", text: "hello" }],
    isError: true,
  });
  expect(f.counts()).toEqual({ opened: 1, closed: 1 });
});
test("call failures still close the session", async () => {
  let closed = false;
  const f = fixture();
  f.dependencies.open = async () => ({
    ...catalogStub,
    listTools: async () => [],
    callTool: async () => {
      throw new Error("Call failed");
    },
    close: async () => {
      closed = true;
    },
  });
  await expect(
    runService(plugin, manifest, ["message", "echo", "--text", "x"], f.dependencies),
  ).rejects.toThrow();
  expect(closed).toBe(true);
});
test("plugin policy runs before connection for mapped and raw calls", async () => {
  const guarded = {
    ...plugin,
    beforeCall: async () => {
      throw new Error("Policy blocked");
    },
  };
  const f = fixture();
  for (const path of [
    ["message", "echo"],
    ["call", "demo-echo"],
  ]) {
    await expect(
      runService(guarded, manifest, [...path, "--text", "x"], f.dependencies),
    ).rejects.toThrow();
  }
  expect(f.counts().opened).toBe(0);
});

test("global-looking string values survive mapped and raw calls", async () => {
  for (const path of [
    ["message", "echo"],
    ["call", "demo-echo"],
  ]) {
    for (const text of ["--help", "--json", "-h"]) {
      const f = fixture();
      await runService(plugin, manifest, [...path, "--text", text], f.dependencies);
      expect(f.calls).toEqual([{ name: "demo-echo", input: { text } }]);
      expect(f.counts()).toEqual({ opened: 1, closed: 1 });
      expect(f.output).toEqual(["hello"]);
    }
  }
});

test("global options work around boolean flags and preserve argv", async () => {
  const f = fixture();
  const args = ["--json", "message", "echo", "--uppercase", "--text", "--help", "--json"];
  const original = [...args];
  await runService(plugin, manifest, args, f.dependencies);
  expect(f.calls).toEqual([{ name: "demo-echo", input: { uppercase: true, text: "--help" } }]);
  expect(f.output[0]).toContain('"content"');
  expect(args).toEqual(original);
});

test("prototype names in schema do not become inherited flag definitions", async () => {
  const inheritedProperties = Object.create({ toString: { type: "boolean" } });
  const customManifest = {
    ...manifest,
    tools: [
      {
        name: "custom",
        inputSchema: {
          type: "object",
          properties: inheritedProperties,
          additionalProperties: false,
        },
      },
    ],
  };
  const custom = { ...plugin, commands: { custom: { path: ["custom"] } } };
  const f = fixture();
  await expect(
    runService(custom, customManifest, ["custom", "--toString"], f.dependencies),
  ).rejects.toBeInstanceOf(UsageError);
  expect(f.counts().opened).toBe(0);
});

test("a broken input schema is not reported as a usage error", async () => {
  const brokenManifest = {
    ...manifest,
    tools: [
      {
        name: "broken",
        inputSchema: { type: "object", properties: { text: { type: "no-such-type" } } },
      },
    ],
  };
  const custom = { ...plugin, commands: { broken: { path: ["broken"] } } };
  const f = fixture();
  const error = await runService(custom, brokenManifest, ["broken"], f.dependencies).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SchemaCompileError);
  expect(error).not.toBeInstanceOf(UsageError);
  expect(f.counts().opened).toBe(0);
});

const callWith = async (args: string[]) => {
  const f = fixture();
  await runService(plugin, manifest, args, f.dependencies);
  return f.calls;
};
const rejectsWith = async (args: string[], message: string) => {
  const f = fixture();
  const error = await runService(plugin, manifest, args, f.dependencies).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(UsageError);
  expect(error).toHaveProperty("message", expect.stringContaining(message));
  expect(f.counts().opened).toBe(0);
};

test("nullable and union fields convert flags to their non-null type", async () => {
  const set = ["field", "set"];
  for (const [args, input] of [
    [["--size", "3"], { size: 3 }],
    [["--size", "null"], { size: null }],
    [["--ratio", "1.5"], { ratio: 1.5 }],
    [["--ratio", "null"], { ratio: null }],
    [["--enabled"], { enabled: true }],
    [["--enabled", "false"], { enabled: false }],
    [["--enabled", "null"], { enabled: null }],
    [["--no-enabled"], { enabled: false }],
    [["--label", "null"], { label: "null" }],
    [["--meta", '{"a":1}'], { meta: { a: 1 } }],
    [["--meta", "null"], { meta: null }],
  ] as const) {
    expect(await callWith([...set, ...args])).toEqual([{ name: "demo-fields", input }]);
  }
});

test("--key=value sets fields and input sources", async () => {
  expect(
    await callWith(["message", "echo", "--text=a=b", "--count=2", "--uppercase=false"]),
  ).toEqual([{ name: "demo-echo", input: { text: "a=b", count: 2, uppercase: false } }]);
  expect(await callWith(["call", "demo-echo", '--input={"text":"x"}'])).toEqual([
    { name: "demo-echo", input: { text: "x" } },
  ]);
  await rejectsWith(["message", "echo", "--no-uppercase=true"], "--no-uppercase");
  await rejectsWith(["message", "echo", "--text", "x", "--json=1"], "--json");
});

test("numbers accept decimal text only and name the flag", async () => {
  for (const raw of ["0x10", "1e400", "", " 3", "Infinity"]) {
    await rejectsWith(["field", "set", "--amount", raw], "--amount");
  }
  for (const raw of ["1.5", "1.0", "0b1"]) {
    await rejectsWith(["message", "echo", "--text", "x", "--count", raw], "--count");
  }
  expect(await callWith(["field", "set", "--amount", "-2.5e1"])).toEqual([
    { name: "demo-fields", input: { amount: -25 } },
  ]);
});

test("invalid JSON values name the flag", async () => {
  await rejectsWith(["message", "echo", "--text", "x", "--labels", "[x"], "--labels");
  await rejectsWith(["call", "demo-echo", "--input", "{x"], "--input");
});

test("arguments without a command path fail", async () => {
  await rejectsWith(["--text", "x"], "Missing command");
  await rejectsWith(["stray-only", "--text", "x"], "Unknown command");
});

test("help for an unknown command is a usage error", async () => {
  await rejectsWith(["missing"], "missing");
  await rejectsWith(["help", "missing"], "missing");
});

test("plugin customizations apply at run time without regenerating", async () => {
  const edited = { ...plugin, commands: { ...commands, "demo-echo": { path: ["say"] } } };
  const f = fixture();
  expect(await runService(edited, manifest, ["say", "--text", "x"], f.dependencies)).toBe(0);
  expect(f.calls).toEqual([{ name: "demo-echo", input: { text: "x" } }]);
  const stale = { ...plugin, commands: { ...commands, removed: { path: ["gone"] } } };
  await expect(runService(stale, manifest, ["--help"], f.dependencies)).rejects.toThrow(
    "missing tool",
  );
});

test("input file read failures are usage errors and - reads stdin", async () => {
  const f = fixture();
  f.dependencies.io.readFile = async () => {
    throw Object.assign(new Error("open failed"), { code: "ENOENT" });
  };
  const error = await runService(
    plugin,
    manifest,
    ["call", "demo-echo", "--input-file", "/nonexistent.json"],
    f.dependencies,
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(UsageError);
  expect(error).toHaveProperty("message", expect.stringContaining("ENOENT"));
  expect(error).toHaveProperty("cause", expect.any(Error));
  for (const args of [["--input-file=-"], ["--input-file", "-"]]) {
    expect(await callWith(["call", "demo-echo", ...args])).toEqual([
      { name: "demo-echo", input: { text: "stdin" } },
    ]);
  }
});

test("input file failures without a system code propagate unchanged", async () => {
  const f = fixture();
  const failure = new Error("Reader crashed");
  f.dependencies.io.readFile = async () => {
    throw failure;
  };
  const error = await runService(
    plugin,
    manifest,
    ["call", "demo-echo", "--input-file", "in.json"],
    f.dependencies,
  ).catch((caught: unknown) => caught);
  expect(error).toBe(failure);
});

test("repeated input sources report the repeated flag", async () => {
  await rejectsWith(
    ["call", "demo-echo", "--input", "{}", "--input", "{}"],
    "Repeated flag: --input",
  );
  await rejectsWith(
    ["call", "demo-echo", "--input", "{}", "--input-file", "a.json"],
    "--input or --input-file",
  );
});

test("dotted flags descend into nullable object unions", async () => {
  expect(await callWith(["shape", "set", "--options.verbose", "--options.page-id", "p"])).toEqual([
    { name: "demo-shape", input: { options: { verbose: true, page_id: "p" } } },
  ]);
  expect(await callWith(["shape", "set", "--options", "null"])).toEqual([
    { name: "demo-shape", input: { options: null } },
  ]);
});

test("reserved-name properties are input-only and globals keep their meaning", async () => {
  const f = fixture();
  await runService(
    plugin,
    manifest,
    ["shape", "set", "--input", '{"json":true,"input_file":"x"}', "--json"],
    f.dependencies,
  );
  expect(f.calls).toEqual([{ name: "demo-shape", input: { json: true, input_file: "x" } }]);
  expect(f.output[0]).toContain('"content"');
  for (const args of [["--no-json"], ["--json.x", "1"], ["--input.x", "1"]]) {
    await rejectsWith(["shape", "set", ...args], "via --input");
  }
  expect(await callWith(["call", "demo-echo", "--input_file=-"])).toEqual([
    { name: "demo-echo", input: { text: "stdin" } },
  ]);
});

test("help shows effective types and input-only reserved properties", async () => {
  const f = fixture();
  await runService(plugin, manifest, ["shape", "set", "--help"], f.dependencies);
  const text = f.output.join("");
  expect(text).toContain("--options  object|null (optional)");
  expect(text).toContain("--size  integer|null (optional)");
  expect(text).toContain("  json  boolean (optional, set via --input only)");
  expect(text).toContain("  input_file  string (optional, set via --input only)");
  expect(text).not.toContain("--input-file  string");
});

test("reserved command help keeps its usage lines", async () => {
  const f = fixture();
  for (const name of ["methods", "help", "skill", "call"]) {
    await runService(plugin, manifest, ["help", name], f.dependencies);
  }
  expect(f.output).toEqual([
    "Usage: demo methods [group] [--json]\n\nList baked-in tool names and command paths.",
    "Usage: demo help [command]\n\nShow help for a command.",
    "Usage: demo skill\n\nPrint the service workflow.",
    [
      "Usage: demo call <tool> [options]\n\nCall a declared tool by its exact name.\nUse demo methods to discover names.",
      "",
      "Tools:",
      "  demo-echo    Echo a message",
      "  demo-fail    Return a tool error",
      "  demo-fields  Accept nullable and union fields",
      "  demo-shape   Accept nullable objects and reserved names",
    ].join("\n"),
  ]);
});

test("root and group help describe each command and the recommended start", async () => {
  const f = fixture();
  const described = definePlugin({
    ...plugin,
    groups: { message: "Send and fail messages" },
    quickstart: [{ command: "message echo --text hi", summary: "Say hi" }],
  });
  await runService(described, manifest, ["--help"], f.dependencies);
  await runService(described, manifest, ["message"], f.dependencies);
  const [root, group] = f.output;
  expect(root).toContain("Start here:\n  demo message echo --text hi  Say hi");
  expect(root).toContain("  message  Send and fail messages\n  shape    1 command");
  expect(root).toContain("Discovery:\n  methods    List tool names and command paths");
  expect(root).not.toContain("  call  \n");
  expect(group).toContain("Usage: demo message <command>\n\nSend and fail messages");
  expect(group).toContain("  echo  Echo a message\n  fail  Return a tool error");
  expect(group).not.toContain("Start here:");
});

const memoryGuard = () => {
  const records = new Map<string, CallRecord>();
  const guard: RepeatGuard = {
    begin: async (service, key, tool, attempt) => {
      const earlier = records.get(`${service}:${key}`);
      if (earlier && earlier.status !== "error") return earlier;
      records.set(`${service}:${key}`, { tool, at: Date.now(), status: "pending", attempt });
      return undefined;
    },
    finish: async (service, key, attempt, status) => {
      const record = records.get(`${service}:${key}`);
      if (record?.attempt === attempt) records.set(`${service}:${key}`, { ...record, status });
    },
  };
  return { guard, records };
};

test("an identical non-idempotent call is refused before connecting", async () => {
  const f = fixture();
  const { guard } = memoryGuard();
  const dependencies = { ...f.dependencies, guard };
  const args = ["message", "echo", "--text", "hi"];
  expect(await runService(plugin, manifest, args, dependencies)).toBe(0);
  const repeat = runService(plugin, manifest, args, dependencies);
  await expect(repeat).rejects.toThrow(RepeatedCallError);
  await expect(runService(plugin, manifest, args, dependencies)).rejects.toThrow(
    "Refusing to repeat message echo: the same input already succeeded",
  );
  expect(await runService(plugin, manifest, [...args, "--allow-repeat"], dependencies)).toBe(0);
  expect(
    await runService(plugin, manifest, ["message", "echo", "--text", "bye"], dependencies),
  ).toBe(0);
  expect(f.calls).toHaveLength(3);
  expect(f.counts()).toEqual({ opened: 3, closed: 3 });
});

test("tool errors allow a retry and read-only or idempotent tools are never guarded", async () => {
  const failing = fixture(true);
  const { guard, records } = memoryGuard();
  const args = ["message", "fail"];
  for (let i = 0; i < 2; i++)
    expect(await runService(plugin, manifest, args, { ...failing.dependencies, guard })).toBe(1);
  expect([...records.values()].map((record) => record.status)).toEqual(["error"]);
  const annotated = {
    ...manifest,
    tools: manifest.tools.map((tool) =>
      tool.name === "demo-echo" ? { ...tool, annotations: { readOnlyHint: true } } : tool,
    ),
  };
  const f = fixture();
  for (let i = 0; i < 2; i++)
    expect(
      await runService(plugin, annotated, ["message", "echo", "--text", "hi"], {
        ...f.dependencies,
        guard,
      }),
    ).toBe(0);
  expect(records.size).toBe(1);
});

test("a call that throws stays pending and blocks the retry", async () => {
  const f = fixture();
  const { guard, records } = memoryGuard();
  const broken = {
    ...f.dependencies,
    guard,
    open: async (): Promise<ToolSession> => {
      const session = await f.dependencies.open();
      return { ...session, callTool: async () => Promise.reject(new Error("timeout")) };
    },
  };
  const args = ["message", "echo", "--text", "hi"];
  await expect(runService(plugin, manifest, args, broken)).rejects.toThrow("timeout");
  expect([...records.values()][0]?.status).toBe("pending");
  await expect(runService(plugin, manifest, args, broken)).rejects.toThrow("outcome is unknown");
});

test("--allow-repeat is a switch that never becomes tool input", async () => {
  const f = fixture();
  await runService(
    plugin,
    manifest,
    ["message", "echo", "--text", "x", "--allow-repeat"],
    f.dependencies,
  );
  expect(f.calls).toEqual([{ name: "demo-echo", input: { text: "x" } }]);
  await expect(
    runService(plugin, manifest, ["message", "echo", "--allow-repeat=yes"], f.dependencies),
  ).rejects.toThrow("does not take a value");
});

const uploading = (fail = false) => {
  const uploads: Array<{ name: string; bytes: number[] }> = [];
  const puts: string[] = [];
  const uploader = definePlugin({
    ...plugin,
    commands: {
      ...commands,
      "demo-echo": { path: ["message", "echo"], uploads: ["text", "labels"] },
    },
    uploadFile: async (file, context) => {
      if (fail) throw new Error("slot refused");
      uploads.push({ name: file.name, bytes: [...file.bytes] });
      await context.putBytes(`put:${file.name}`, file.bytes);
      return `https://files/${file.name}`;
    },
  });
  const putBytes = async (url: string) => {
    puts.push(url);
  };
  return { uploader, uploads, puts, putBytes };
};

test("@paths in upload fields are uploaded and replaced by URLs before the call", async () => {
  const f = fixture();
  const { uploader, uploads, puts, putBytes } = uploading();
  const args = ["message", "echo", "--text", "@a.wav", "--labels", '["@b.wav","plain","@a.wav"]'];
  expect(await runService(uploader, manifest, args, { ...f.dependencies, putBytes })).toBe(0);
  expect(uploads).toEqual([
    { name: "a.wav", bytes: [1, 2] },
    { name: "b.wav", bytes: [3] },
  ]);
  expect(puts).toEqual(["put:a.wav", "put:b.wav"]);
  expect(f.calls).toEqual([
    {
      name: "demo-echo",
      input: {
        text: "https://files/a.wav",
        labels: ["https://files/b.wav", "plain", "https://files/a.wav"],
      },
    },
  ]);
});

test("@ stays literal outside upload fields and https URLs pass through", async () => {
  const f = fixture();
  await runService(plugin, manifest, ["message", "echo", "--text", "@here hi"], f.dependencies);
  const { uploader, uploads, putBytes } = uploading();
  const url = ["message", "echo", "--text", "https://example.com/a.wav"];
  await runService(uploader, manifest, url, { ...f.dependencies, putBytes });
  expect(uploads).toEqual([]);
  expect(f.calls).toEqual([
    { name: "demo-echo", input: { text: "@here hi" } },
    { name: "demo-echo", input: { text: "https://example.com/a.wav" } },
  ]);
});

test("unreadable files and missing transfer ports fail before connecting", async () => {
  const f = fixture();
  const { uploader, putBytes } = uploading();
  const run = (text: string, withPut = true) =>
    runService(uploader, manifest, ["message", "echo", "--text", text], {
      ...f.dependencies,
      ...(withPut && { putBytes }),
    });
  await expect(run("@missing.wav")).rejects.toThrow("Cannot read file for --text: missing.wav");
  await expect(run("@")).rejects.toThrow(UsageError);
  await expect(run("@a.wav", false)).rejects.toThrow("cannot upload local files");
  expect(f.counts()).toEqual({ opened: 0, closed: 0 });
});

test("repeat keys follow file contents and refuse before uploading again", async () => {
  const f = fixture();
  const { guard } = memoryGuard();
  const { uploader, uploads, putBytes } = uploading();
  const dependencies = { ...f.dependencies, guard, putBytes };
  const echo = (text: string) =>
    runService(uploader, manifest, ["message", "echo", "--text", text], dependencies);
  expect(await echo("@a.wav")).toBe(0);
  await expect(echo("@copy.wav")).rejects.toThrow(RepeatedCallError);
  expect(await echo("@b.wav")).toBe(0);
  expect(uploads.map((upload) => upload.name)).toEqual(["a.wav", "b.wav"]);
});

test("a failed upload closes the session and leaves the retry allowed", async () => {
  const f = fixture();
  const { guard, records } = memoryGuard();
  const { uploader, putBytes } = uploading(true);
  const args = ["message", "echo", "--text", "@a.wav"];
  const dependencies = { ...f.dependencies, guard, putBytes };
  await expect(runService(uploader, manifest, args, dependencies)).rejects.toThrow("slot refused");
  await expect(runService(uploader, manifest, args, dependencies)).rejects.toThrow("slot refused");
  expect([...records.values()].map((record) => record.status)).toEqual(["error"]);
  expect(f.calls).toEqual([]);
  expect(f.counts()).toEqual({ opened: 2, closed: 2 });
});

test("a failed connection proves the tool never ran and leaves the retry allowed", async () => {
  const f = fixture();
  const { guard, records } = memoryGuard();
  let opens = 0;
  const offline = {
    ...f.dependencies,
    guard,
    open: async (): Promise<ToolSession> => {
      opens++;
      throw new Error("login required");
    },
  };
  const args = ["message", "echo", "--text", "hi"];
  await expect(runService(plugin, manifest, args, offline)).rejects.toThrow("login required");
  await expect(runService(plugin, manifest, args, offline)).rejects.toThrow("login required");
  expect(opens).toBe(2);
  expect([...records.values()].map((record) => record.status)).toEqual(["error"]);
});

test("upload fields with URL format or pattern accept @paths and check the uploaded URL", async () => {
  const constrained = (rule: Record<string, string>) => ({
    ...manifest,
    tools: manifest.tools.map((tool) =>
      tool.name === "demo-echo"
        ? {
            ...tool,
            inputSchema: {
              ...tool.inputSchema,
              properties: {
                ...(isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {}),
                text: { type: "string", ...rule },
              },
            },
          }
        : tool,
    ),
  });
  const f = fixture();
  const { uploader, putBytes } = uploading();
  const dependencies = { ...f.dependencies, putBytes };
  const echo = (rule: Record<string, string>, text: string) =>
    runService(uploader, constrained(rule), ["message", "echo", "--text", text], dependencies);
  expect(await echo({ format: "uri" }, "@a.wav")).toBe(0);
  expect(await echo({ pattern: "^https://files/" }, "@b.wav")).toBe(0);
  await expect(echo({ format: "uri" }, "not a url")).rejects.toThrow(UsageError);
  await expect(echo({ pattern: "^https://other/" }, "@a.wav")).rejects.toThrow(UsageError);
  expect(f.calls).toEqual([
    { name: "demo-echo", input: { text: "https://files/a.wav" } },
    { name: "demo-echo", input: { text: "https://files/b.wav" } },
  ]);
});

const twoKeys = definePlugin({
  ...plugin,
  auth: {
    type: "apiKey",
    env: "KEY",
    alternates: [{ flag: "xoxb", env: "BOT_KEY", summary: "Use the bot token" }],
  },
});

test("a credential switch reaches open anywhere in argv and never becomes input", async () => {
  const f = fixture();
  const seen: Array<string | undefined> = [];
  const dependencies = {
    ...f.dependencies,
    open: async (credential?: string) => {
      seen.push(credential);
      return f.dependencies.open();
    },
  };
  await runService(twoKeys, manifest, ["--xoxb", "message", "echo", "--text", "a"], dependencies);
  await runService(twoKeys, manifest, ["message", "echo", "--text", "b", "--xoxb"], dependencies);
  await runService(twoKeys, manifest, ["message", "echo", "--text", "c"], dependencies);
  expect(seen).toEqual(["xoxb", "xoxb", undefined]);
  expect(f.calls).toHaveLength(3);
  expect(JSON.stringify(f.calls)).not.toContain("xoxb");
  await expect(
    runService(plugin, manifest, ["message", "echo", "--text", "d", "--xoxb"], dependencies),
  ).rejects.toThrow(UsageError);
  await expect(
    runService(twoKeys, manifest, ["message", "echo", "--xoxb=yes"], dependencies),
  ).rejects.toThrow("does not take a value");
});

test("the same input as user and as bot are different calls for the repeat guard", async () => {
  const f = fixture();
  const { guard } = memoryGuard();
  const dependencies = { ...f.dependencies, guard };
  const args = ["message", "echo", "--text", "hi"];
  expect(await runService(twoKeys, manifest, args, dependencies)).toBe(0);
  expect(await runService(twoKeys, manifest, [...args, "--xoxb"], dependencies)).toBe(0);
  await expect(runService(twoKeys, manifest, [...args, "--xoxb"], dependencies)).rejects.toThrow(
    RepeatedCallError,
  );
});

test("help lists credential switches at the root and on every command", async () => {
  const f = fixture();
  await runService(twoKeys, manifest, ["--help"], f.dependencies);
  await runService(twoKeys, manifest, ["message", "echo", "--help"], f.dependencies);
  const [root, leaf] = f.output;
  expect(root).toContain("Credentials:\n  --xoxb  Use the bot token; overridden by BOT_KEY");
  expect(leaf).toContain("  --xoxb                Use the bot token");
});
