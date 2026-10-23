import { UsageError } from "@mcp-cli/core";
import { daemonRequest, daemonStatus } from "./client";
import { prepareOwnership } from "./ownership";
import { daemonDirectory } from "./endpoint";
import { startDaemon } from "./server";

export const daemonCommand = async (args: string[]) => {
  const [action, ...rest] = args;
  if (rest.length || !action || !["start", "status", "reset", "stop", "recover"].includes(action))
    throw new UsageError("Usage: mcp-cli daemon <start|status|reset|stop|recover>");
  if (action === "recover") {
    await prepareOwnership(daemonDirectory());
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
    console.log(JSON.stringify({ event: "ready", pid: process.pid }));
    return;
  }
  console.log(
    JSON.stringify(action === "status" ? await daemonStatus() : await daemonRequest(action)),
  );
};
