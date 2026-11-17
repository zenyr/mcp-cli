import { formatOutput } from "@mcp-cli/runtime";
import { UsageError } from "@mcp-cli/core";
import { daemonRequest, daemonStatus } from "./client";
import { prepareOwnership } from "./ownership";
import { daemonDirectory } from "./endpoint";
import { startDaemon } from "./server";

export const daemonCommand = async (argv: string[]) => {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const write = (value: unknown) => console.log(json ? JSON.stringify(value) : formatOutput(value));
  const [action, ...rest] = args;
  if (rest.length || !action || !["start", "status", "reset", "stop", "recover"].includes(action))
    throw new UsageError("Usage: mcp-cli daemon <start|status|reset|stop|recover>");
  if (action === "recover") {
    await prepareOwnership(daemonDirectory(process.env));
    return;
  }
  if (action === "start") {
    const daemon = await startDaemon();
    const stop = () => {
      void daemon.stop().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    write({ event: "ready", pid: process.pid });
    return;
  }
  write(action === "status" ? await daemonStatus() : await daemonRequest(action));
};
