import {
  parseJSONRPCMessage,
  serializeMessage,
  type Transport,
} from "@modelcontextprotocol/client";
import type { Child, Runtime } from "./runtime";

export const stdioTransport = (runtime: Runtime): Transport => {
  let child: Child | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let closed = false;
  let reading: Promise<void> | undefined;
  const finish = () => {
    if (closed) return;
    closed = true;
    transport.onclose?.();
  };
  const transport: Transport = {
    start: async () => {
      if (child) throw new Error("이미 시작한 연결입니다.");
      child = runtime.spawn([runtime.executable, "--stdio-server"]);
      writer = child.input.getWriter();
      const reader = child.output.getReader();
      const decoder = new TextDecoder();
      reading = (async () => {
        let pending = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 1024 * 1024) throw new Error("응답 크기 제한을 넘었습니다.");
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) transport.onmessage?.(parseJSONRPCMessage(JSON.parse(line)));
          }
        }
        if ((pending + decoder.decode()).trim()) throw new Error("응답이 중간에 끝났습니다.");
      })()
        .catch((error: unknown) => {
          transport.onerror?.(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(finish);
    },
    send: async (message) => {
      if (!writer || closed) throw new Error("연결이 닫혔습니다.");
      await writer.write(new TextEncoder().encode(serializeMessage(message)));
    },
    close: async () => {
      if (!child) return;
      await writer?.close().catch(() => undefined);
      await child.exited;
      await reading;
      finish();
    },
  };
  return transport;
};

export const serveStdio = async (runtime: Runtime) => {
  const decoder = new TextDecoder();
  const reader = runtime.input.getReader();
  const writer = runtime.output.getWriter();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = parseJSONRPCMessage(JSON.parse(line));
      if (!("method" in message) || !("id" in message)) continue;
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "stdio-probe", version: "1.0.0" },
            }
          : message.method === "tools/list"
            ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: "한글🙂 stdio" }] };
      const bytes = new TextEncoder().encode(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n",
      );
      for (let offset = 0; offset < bytes.length; offset += 7)
        await writer.write(bytes.slice(offset, offset + 7));
    }
  }
  await writer.close();
};
