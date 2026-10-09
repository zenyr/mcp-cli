import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Entry, Kind, Node, Scope, Settings, Store, SummaryResult } from "./types";
import { createHash } from "node:crypto";
import { end, fail } from "./values";
import { createPinStore } from "./pins-store";

export const generationFor = (settings: Settings): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
        model: settings.model,
        thinking: settings.thinking,
        baseUrl: settings.baseUrl,
        nodeBytes: settings.nodeBytes,
        contextBytes: settings.contextBytes,
        inputBytes: settings.inputBytes,
      }),
    )
    .digest("hex")
    .slice(0, 24);

export const openStore = (path: string): Store => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  chmodSync(path, 0o600);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
  if (version !== 0 && version !== 1 && version !== 2) {
    db.close();
    return fail("SCHEMA_VERSION", "Unsupported memory database version.");
  }
  const initialize = () => {
    try {
      return db
        .transaction(() => {
          db.exec(`
    CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (
      scope TEXT NOT NULL, i INTEGER NOT NULL CHECK(i>=0), kind TEXT NOT NULL,
      text TEXT NOT NULL, date TEXT NOT NULL, receipt TEXT NOT NULL,
      PRIMARY KEY(scope,i), UNIQUE(scope,receipt));
    CREATE TABLE IF NOT EXISTS nodes (
      scope TEXT NOT NULL, generation TEXT NOT NULL, l INTEGER NOT NULL, i INTEGER NOT NULL,
      text TEXT NOT NULL, PRIMARY KEY(scope,generation,l,i));
    CREATE TABLE IF NOT EXISTS leases (
      scope TEXT NOT NULL, generation TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL,
      error TEXT, PRIMARY KEY(scope,generation));
    CREATE TABLE IF NOT EXISTS usage (
      scope TEXT NOT NULL, generation TEXT NOT NULL, model TEXT NOT NULL,
      inputTokens INTEGER NOT NULL, outputTokens INTEGER NOT NULL, measured INTEGER NOT NULL);
  `);
          const pins = createPinStore(db);
          db.exec("PRAGMA user_version=2");
          return pins;
        })
        .immediate();
    } catch (error) {
      db.close();
      throw error;
    }
  };
  const pinStore = initialize();
  const selectEntries = db.query<Entry, [string, number]>(
    "SELECT * FROM entries WHERE scope=? AND i<? ORDER BY i",
  );
  const entries = (scope: string, before = Number.MAX_SAFE_INTEGER): Entry[] => {
    const rows = selectEntries.all(scope, before);
    if (rows.some((row, index) => row.i !== index))
      fail("LOG_CORRUPT", "Memory log has a missing message index.");
    return rows;
  };
  const selectNodes = db.query<Node, [string, string]>(
    "SELECT l,i,text FROM nodes WHERE scope=? AND generation=? ORDER BY l,i",
  );
  const checkOwner = (scope: string, generation: string, owner: string) => {
    const lease = db
      .query<{ owner: string; expires: number }, [string, string]>(
        "SELECT owner,expires FROM leases WHERE scope=? AND generation=?",
      )
      .get(scope, generation);
    if (lease?.owner !== owner || lease.expires <= Date.now())
      fail("LEASE_LOST", "Summary lease expired; no node was published.");
  };
  return {
    ...pinStore,
    scope: (scope) => {
      db.query(
        "INSERT INTO scopes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
      ).run(scope.id, scope.name, scope.kind);
    },
    entries,
    entry: (scope, i) =>
      db
        .query<Entry, [string, number]>("SELECT * FROM entries WHERE scope=? AND i=?")
        .get(scope, i) ?? undefined,
    append: (scope: string, kind: Kind, text: string, receipt: string) =>
      db
        .transaction(() => {
          const prior = db
            .query<Entry, [string, string]>("SELECT * FROM entries WHERE scope=? AND receipt=?")
            .get(scope, receipt);
          if (prior) {
            if (prior.text !== text || prior.kind !== kind)
              fail("IDEMPOTENCY_CONFLICT", "Receipt already identifies a different message.");
            return prior;
          }
          const next = db
            .query<{ i: number }, [string]>(
              "SELECT COALESCE(MAX(i)+1,0) AS i FROM entries WHERE scope=?",
            )
            .get(scope);
          const entry: Entry = {
            scope,
            i: next?.i ?? 0,
            kind,
            text,
            date: new Date().toISOString(),
            receipt,
          };
          db.query("INSERT INTO entries VALUES(?,?,?,?,?,?)").run(
            scope,
            entry.i,
            kind,
            text,
            entry.date,
            receipt,
          );
          return entry;
        })
        .immediate(),
    nodes: (scope, generation) => selectNodes.all(scope, generation),
    node: (scope, generation, l, i) =>
      db
        .query<Node, [string, string, number, number]>(
          "SELECT l,i,text FROM nodes WHERE scope=? AND generation=? AND l=? AND i=?",
        )
        .get(scope, generation, l, i) ?? undefined,
    publish: (
      scope: string,
      generation: string,
      owner: string,
      node: Node,
      _usage: SummaryResult,
    ) =>
      db
        .transaction(() => {
          checkOwner(scope, generation, owner);
          if (
            !Number.isSafeInteger(node.l) ||
            node.l < 0 ||
            node.l > 52 ||
            !Number.isSafeInteger(node.i) ||
            node.i < 0 ||
            !Number.isSafeInteger(end(node)) ||
            !node.text.trim()
          )
            fail("INVALID_NODE", "Invalid summary node.");
          const history = entries(scope);
          if (end(node) > history.length)
            fail("INVALID_NODE", "Summary is outside the original log.");
          if (node.l > 0) {
            const children = db
              .query<{ count: number }, [string, string, number, number, number]>(
                "SELECT COUNT(*) AS count FROM nodes WHERE scope=? AND generation=? AND l=? AND i IN (?,?)",
              )
              .get(scope, generation, node.l - 1, node.i * 2, node.i * 2 + 1);
            if (children?.count !== 2)
              fail("NODE_UNAVAILABLE", "Both children must be durable before their parent.");
          }
          db.query("INSERT INTO nodes VALUES(?,?,?,?,?)").run(
            scope,
            generation,
            node.l,
            node.i,
            node.text,
          );
          db.query("UPDATE leases SET error=NULL WHERE scope=? AND generation=?").run(
            scope,
            generation,
          );
        })
        .immediate(),
    recordUsage: (scope, generation, usage) => {
      if (usage.model !== "verbatim")
        db.query("INSERT INTO usage VALUES(?,?,?,?,?,?)").run(
          scope,
          generation,
          usage.model,
          usage.inputTokens,
          usage.outputTokens,
          usage.usageKnown ? 1 : 0,
        );
    },
    claim: (scope, generation, owner) => {
      const result = db
        .query(`INSERT INTO leases VALUES(?,?,?,?,NULL)
        ON CONFLICT(scope,generation) DO UPDATE SET owner=excluded.owner,expires=excluded.expires
        WHERE leases.expires<=? OR leases.owner=?`)
        .run(scope, generation, owner, Date.now() + 180000, Date.now(), owner);
      if (result.changes !== 1)
        fail(
          "MEMORY_BUSY",
          "Another process is summarizing this scope; retry mem summarize later.",
        );
    },
    renew: (scope, generation, owner) => {
      const now = Date.now();
      const result = db
        .query(
          "UPDATE leases SET expires=? WHERE scope=? AND generation=? AND owner=? AND expires>?",
        )
        .run(now + 180000, scope, generation, owner, now);
      if (result.changes !== 1)
        fail("LEASE_LOST", "Summary lease ownership was lost; no result will be published.");
    },
    release: (scope, generation, owner) => {
      db.query("UPDATE leases SET expires=0 WHERE scope=? AND generation=? AND owner=?").run(
        scope,
        generation,
        owner,
      );
    },
    failed: (scope, generation, owner, message) => {
      db.query("UPDATE leases SET error=? WHERE scope=? AND generation=? AND owner=?").run(
        message.slice(0, 1000),
        scope,
        generation,
        owner,
      );
    },
    status: (scopes: Scope[], generation) =>
      scopes.map((scope) => {
        const messages = entries(scope.id).length;
        const nodes = selectNodes.all(scope.id, generation);
        const lastError =
          db
            .query<{ error: string | null }, [string, string]>(
              "SELECT error FROM leases WHERE scope=? AND generation=?",
            )
            .get(scope.id, generation)?.error ?? null;
        return {
          ...scope,
          messages,
          nodes: nodes.length,
          pending: messages - nodes.filter((node) => node.l === 0).length,
          lastError,
        };
      }),
    usage: () =>
      db
        .query<
          { calls: number; inputTokens: number; outputTokens: number; unmeasuredCalls: number },
          []
        >(
          "SELECT COUNT(*) AS calls, COALESCE(SUM(inputTokens),0) AS inputTokens, COALESCE(SUM(outputTokens),0) AS outputTokens, COALESCE(SUM(measured=0),0) AS unmeasuredCalls FROM usage",
        )
        .get() ?? { calls: 0, inputTokens: 0, outputTokens: 0, unmeasuredCalls: 0 },
    close: () => db.close(),
  };
};
