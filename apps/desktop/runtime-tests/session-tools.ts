import { sessionTools } from "../../../packages/mcp/src/session-tools";
import { deferred, equal, rejects, type RuntimeCase } from "./contract";

const tools = [{ name: "new", inputSchema: { type: "object" } }];

export const sessionToolCases: RuntimeCase[] = [
  {
    name: "Session catalogs single-flight, replace with empty, and isolate connections",
    run: async () => {
      let calls = 0;
      const gate = deferred();
      const catalog = sessionTools(async () => {
        calls++;
        await gate.promise;
        return calls === 1 ? tools : [];
      });
      const first = catalog.list();
      const second = catalog.list();
      equal(first === second, true);
      gate.resolve();
      equal(await first, tools);
      equal(await second, tools);
      equal(await catalog.list(), tools);
      equal(calls, 1);
      catalog.invalidate();
      equal(await catalog.list(), []);
      equal(calls, 2);
      const other = sessionTools(async () => tools);
      equal(await other.list(), tools);
    },
  },
  {
    name: "List changes during discovery cannot publish a stale generation",
    run: async () => {
      const gate = deferred();
      const started = deferred();
      let calls = 0;
      const catalog = sessionTools(async () => {
        calls++;
        if (calls === 1) {
          started.resolve();
          await gate.promise;
          return tools;
        }
        return [];
      });
      const first = catalog.list();
      await started.promise;
      catalog.invalidate();
      const second = catalog.list();
      equal(await second, []);
      gate.resolve();
      equal(await first, []);
      equal(await catalog.list(), []);
      equal(calls, 2);
    },
  },
  {
    name: "Discovery failures are shared but not retained forever",
    run: async () => {
      let calls = 0;
      const catalog = sessionTools(async () => {
        if (++calls === 1) throw new Error("offline");
        return tools;
      });
      const first = catalog.list();
      const second = catalog.list();
      await rejects(first);
      await rejects(second);
      equal(calls, 1);
      equal(await catalog.list(), tools);
      equal(calls, 2);
    },
  },
];
