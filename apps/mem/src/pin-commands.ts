import type { Options } from "./options";
import type { Scope, Store } from "./types";
import { fail } from "./values";

export const pinCommand = (store: Store, scopes: Scope[], options: Options): unknown => {
  if (options.command === "pins")
    return {
      ok: true,
      pins: scopes.flatMap((scope) =>
        store.pins(scope.id).filter((pin) => !options.key || pin.key === options.key),
      ),
    };
  const scope = scopes[0];
  if (!scope) return fail("PROJECT_REQUIRED", "Use --global outside a Git project.");
  const receipt = options.receipt;
  const expectedRevision = options.expectedRevision;
  if (!receipt || expectedRevision === undefined)
    return fail("INVALID_OPTION", "Pin changes require revision and receipt.");
  const arg = options.text[0] ?? "";
  let pin;
  if (options.command === "unpin")
    pin = store.changePin({ scope: scope.id, key: arg, expectedRevision, receipt, op: "unpin" });
  else {
    const slash = arg.lastIndexOf("/");
    const number = arg.slice(slash + 1);
    if (slash < 1 || !/^\d+$/.test(number) || !Number.isSafeInteger(Number(number)))
      return fail("INVALID_OPTION", "Invalid record ID.");
    if (arg.slice(0, slash) !== scope.id)
      return fail("RECORD_UNAVAILABLE", "Pin source must belong to selected scope.");
    const { key, from, to } = options;
    if (!key || from === undefined || to === undefined)
      return fail("INVALID_OPTION", "Pin source range and key are required.");
    pin = store.changePin({
      scope: scope.id,
      key,
      expectedRevision,
      receipt,
      op: "pin",
      i: Number(number),
      from,
      to,
    });
  }
  return {
    ok: true,
    receipt,
    pin: {
      scope: pin.scope,
      key: pin.key,
      revision: pin.revision,
      active: pin.active,
      source: pin.source,
      kind: pin.kind,
    },
  };
};
