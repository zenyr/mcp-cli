import { createDrainController } from "../shared/drain-controller";
import type { UpdateInstance } from "../shared/update-instance";
import { createUpdateRequestHandler, isRequestFailure } from "../shared/update-request";
import { equal, rejects, type RuntimeCase } from "./contract";

const instanceId = "instance-1";
const request = (requestId: string) => JSON.stringify({ instanceId, requestId });

const harness = (failures: number) => {
  const operations = createDrainController();
  const records: Array<{ state: UpdateInstance["state"]; error?: string; requestId?: string }> = [];
  const events: string[] = [];
  let pending: string | null = null;
  let remaining = failures;
  const handler = createUpdateRequestHandler({
    instanceId,
    read: async () => pending,
    record: async (state, detail) => {
      records.push({ state, ...detail });
    },
    stop: async () => {
      events.push("stop");
      await operations.drain(async () => {});
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("daemon stop failed");
      }
    },
    resume: operations.resume,
    discard: async () => {
      events.push("discard");
      pending = null;
    },
    finish: async () => {
      events.push("quit");
      pending = null;
    },
  });
  return {
    operations,
    records,
    events,
    handler,
    send: (text: string | null) => {
      pending = text;
    },
  };
};

export const updateRequestCases: RuntimeCase[] = [
  {
    name: "resume reopens a drained controller",
    run: async () => {
      const operations = createDrainController();
      await operations.drain(async () => {});
      await rejects(operations.run(async () => {}));
      operations.resume();
      equal(operations.accepting(), true);
      equal(await operations.run(async () => "served"), "served");
    },
  },
  {
    name: "failed update stop returns the app to service and keeps the failure readable",
    run: async () => {
      const { operations, records, events, handler, send } = harness(1);
      await handler.start();
      send(request("first"));
      await handler.check();
      equal(operations.accepting(), true);
      equal(await operations.run(async () => "served"), "served");
      equal(records.at(-1), { state: "failed", error: "daemon stop failed", requestId: "first" });
      await handler.ready();
      equal(records.at(-1)?.state, "failed");
      send(request("first"));
      await handler.check();
      equal(events, ["stop", "discard"]);
    },
  },
  {
    name: "a later update request retries the drain after a failure",
    run: async () => {
      const { operations, records, events, handler, send } = harness(1);
      await handler.start();
      await handler.ready();
      send(request("first"));
      await handler.check();
      send(request("second"));
      await handler.check();
      equal(events, ["stop", "discard", "stop", "quit"]);
      equal(
        records.map((item) => item.state),
        ["starting", "ready", "draining", "failed", "draining"],
      );
      equal(operations.accepting(), false);
      send(request("third"));
      await handler.check();
      equal(events.length, 4);
    },
  },
  {
    name: "requests for another instance are ignored",
    run: async () => {
      const { records, events, handler, send } = harness(0);
      await handler.start();
      send(JSON.stringify({ instanceId: "other", requestId: "first" }));
      await handler.check();
      equal(events, []);
      equal(records.length, 1);
    },
  },
  {
    name: "graceful update ignores a failure left by an earlier request",
    run: () => {
      const failed: UpdateInstance = {
        instanceId,
        pid: 10,
        launcherPid: 9,
        executable: "/app",
        state: "failed",
        requestId: "first",
      };
      equal(isRequestFailure(failed, "second"), false);
      equal(isRequestFailure(failed, "first"), true);
      equal(isRequestFailure({ ...failed, requestId: undefined }, "second"), true);
      equal(isRequestFailure({ ...failed, state: "draining" }, "first"), false);
    },
  },
];
