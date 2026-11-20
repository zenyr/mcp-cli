export type UpdateInstance = {
  instanceId: string;
  pid: number;
  launcherPid: number;
  executable: string;
  daemonDirectory?: string;
  state: "starting" | "ready" | "draining" | "failed";
  error?: string;
  requestId?: string;
};

export const isUpdateInstance = (value: unknown): value is UpdateInstance => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "instanceId" in value &&
    typeof value.instanceId === "string" &&
    value.instanceId.length > 0 &&
    "pid" in value &&
    typeof value.pid === "number" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    "launcherPid" in value &&
    typeof value.launcherPid === "number" &&
    Number.isInteger(value.launcherPid) &&
    value.launcherPid > 0 &&
    "executable" in value &&
    typeof value.executable === "string" &&
    "state" in value &&
    ["starting", "ready", "draining", "failed"].includes(String(value.state)) &&
    (!("daemonDirectory" in value) || typeof value.daemonDirectory === "string") &&
    (!("error" in value) || typeof value.error === "string") &&
    (!("requestId" in value) || typeof value.requestId === "string")
  );
};
