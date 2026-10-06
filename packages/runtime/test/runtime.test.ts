import { expect, test } from "bun:test";
import { UsageError, definePlugin, type ToolSession } from "@mcp-cli/core";
import { SchemaCompileError } from "@mcp-cli/schema";
import { runService } from "../src";
import { catalogStub, commands, manifest } from "./fixtures/manifest";

const plugin = definePlugin({
  name: "demo",
  summary: "Demo",
  commands,
  connection: () => ({ type: "stdio", command: "unused" }),
});
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
    "Usage: demo call <tool> [options]\n\nCall a baked-in MCP tool by its exact name.\nUse demo methods to discover names.",
  ]);
});
