import { UsageError } from "@mcp-cli/core";
import { daemonRequest, daemonStatus } from "./client";
import { startDaemon } from "./server";

export const daemonCommand = async (args: string[]) => {
  const [action, ...rest] = args;
  if (rest.length || !action || !["start", "status", "reset", "stop"].includes(action))
    throw new UsageError("Usage: mcp-cli daemon <start|status|reset|stop>");
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
