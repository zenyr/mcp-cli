import type { Database } from "bun:sqlite";
import type { Entry, Kind, Pin, PinChange, Store } from "./types";
import { fail } from "./values";

type PinEvent = {
  scope: string;
  key: string;
  revision: number;
  receipt: string;
  payload: string;
  op: "pin" | "unpin";
  i: number;
  from: number;
  to: number;
  kind: Kind | null;
  text: string | null;
};

const snapshot = (event: PinEvent): Pin => ({
  scope: event.scope,
  key: event.key,
  revision: event.revision,
  active: event.op === "pin",
  source: { i: event.i, from: event.from, to: event.to },
  ...(event.kind === null ? {} : { kind: event.kind }),
  ...(event.text === null ? {} : { text: event.text }),
});

const canonical = (change: PinChange): string =>
  JSON.stringify([
    change.key,
    change.expectedRevision,
    change.op,
    ...(change.op === "pin" ? [change.i, change.from, change.to] : []),
  ]);

const validate = (change: PinChange): void => {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(change.key))
    fail(
      "INVALID_PIN",
      "Pin key must contain 1 to 64 ASCII letters, digits, dots, underscores or hyphens.",
    );
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(change.receipt))
    fail("INVALID_RECEIPT", "Pin receipt must be a UUID.");
  if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0)
    fail("INVALID_PIN", "Expected revision must be a nonnegative safe integer.");
};

export const createPinStore = (db: Database): Pick<Store, "pins" | "changePin"> => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pin_events (
      scope TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL,
      receipt TEXT NOT NULL, payload TEXT NOT NULL, op TEXT NOT NULL,
      i INTEGER NOT NULL, "from" INTEGER NOT NULL, "to" INTEGER NOT NULL,
      kind TEXT, text TEXT, date TEXT NOT NULL,
      PRIMARY KEY(scope,key,revision), UNIQUE(scope,receipt));
    CREATE VIEW IF NOT EXISTS latest_pins AS
      SELECT event.* FROM pin_events event
      WHERE NOT EXISTS (
        SELECT 1 FROM pin_events newer WHERE newer.scope=event.scope
        AND newer.key=event.key AND newer.revision>event.revision);
  `);
  const latest = db.query<PinEvent, [string, string]>(
    "SELECT * FROM latest_pins WHERE scope=? AND key=?",
  );
  const source = db.query<Entry, [string, number]>("SELECT * FROM entries WHERE scope=? AND i=?");
  const pins = (scope: string): Pin[] =>
    db
      .query<PinEvent, [string]>("SELECT * FROM latest_pins WHERE scope=? ORDER BY key")
      .all(scope)
      .map((event) => {
        const entry = source.get(scope, event.i);
        return {
          ...snapshot(event),
          kind: entry?.kind ?? event.kind ?? undefined,
          text: entry ? Array.from(entry.text).slice(event.from, event.to).join("") : undefined,
        };
      });
  const changePin = (change: PinChange): Pin =>
    db
      .transaction(() => {
        validate(change);
        const payload = canonical(change);
        const recorded = db
          .query<PinEvent, [string, string]>("SELECT * FROM pin_events WHERE scope=? AND receipt=?")
          .get(change.scope, change.receipt);
        if (recorded) {
          if (recorded.payload !== payload)
            fail("IDEMPOTENCY_CONFLICT", "Receipt already identifies a different pin change.");
          return snapshot(recorded);
        }
        const previous = latest.get(change.scope, change.key);
        if ((previous?.revision ?? 0) !== change.expectedRevision)
          fail("REVISION_CONFLICT", "Pin revision does not match the expected revision.");
        if (change.expectedRevision === Number.MAX_SAFE_INTEGER)
          fail("INVALID_PIN", "Pin revision cannot exceed the safe integer limit.");
        let original: Entry | null = null;
        let text: string | null = previous?.text ?? null;
        if (change.op === "pin") {
          if (
            !Number.isSafeInteger(change.i) ||
            change.i < 0 ||
            !Number.isSafeInteger(change.from) ||
            !Number.isSafeInteger(change.to) ||
            change.from < 0 ||
            change.to <= change.from
          )
            fail(
              "INVALID_PIN",
              "Pin source must specify a nonempty scalar range and nonnegative message index.",
            );
          original = source.get(change.scope, change.i);
          if (!original) return fail("SOURCE_UNAVAILABLE", "Original pin source is unavailable.");
          const scalars = Array.from(original.text);
          if (change.to > scalars.length)
            fail("INVALID_PIN", "Pin range is outside the original source.");
          text = scalars.slice(change.from, change.to).join("");
          const count =
            db
              .query<{ count: number }, [string]>(
                "SELECT COUNT(*) AS count FROM latest_pins WHERE scope=? AND op='pin'",
              )
              .get(change.scope)?.count ?? 0;
          if (previous?.op !== "pin" && count >= 8)
            fail("PIN_OVERFLOW", "A scope can contain at most eight active pins.");
        } else if (previous?.op !== "pin") {
          return fail("PIN_INACTIVE", "Only an active pin can be released.");
        }
        const event: PinEvent = {
          scope: change.scope,
          key: change.key,
          revision: change.expectedRevision + 1,
          receipt: change.receipt,
          payload,
          op: change.op,
          i: change.op === "pin" ? change.i : (previous?.i ?? 0),
          from: change.op === "pin" ? change.from : (previous?.from ?? 0),
          to: change.op === "pin" ? change.to : (previous?.to ?? 0),
          kind: original?.kind ?? previous?.kind ?? null,
          text,
        };
        db.query(`INSERT INTO pin_events
      (scope,key,revision,receipt,payload,op,i,"from","to",kind,text,date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          event.scope,
          event.key,
          event.revision,
          event.receipt,
          event.payload,
          event.op,
          event.i,
          event.from,
          event.to,
          event.kind,
          event.text,
          new Date().toISOString(),
        );
        return snapshot(event);
      })
      .immediate();
  return { pins, changePin };
};
