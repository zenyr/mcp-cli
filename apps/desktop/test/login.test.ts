import { expect, test } from "bun:test";
import { createLoginController } from "../shared/login-controller";

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

test("cancel during preparation settles login and permits another attempt", async () => {
  const logins = createLoginController();
  const preparation = deferred();
  let spawned = false;
  const pending = logins.start(async (signal) => {
    await preparation.promise;
    signal.throwIfAborted();
    spawned = true;
  });
  await logins.cancel();
  expect(await pending).toEqual({ cancelled: true });
  expect(await logins.start(async () => null)).toBeNull();
  preparation.resolve();
  await Promise.resolve();
  expect(spawned).toBe(false);
});

test("cancel aborts active login without waiting for its process response", async () => {
  const logins = createLoginController();
  const started = deferred();
  const stopped = deferred();
  const pending = logins.start(async (signal) => {
    signal.addEventListener("abort", stopped.resolve, { once: true });
    started.resolve();
    await stopped.promise;
    throw new Error("terminated");
  });
  await started.promise;
  await expect(logins.start(async () => null)).rejects.toThrow();
  await logins.cancel();
  expect(await pending).toEqual({ cancelled: true });
  expect(await logins.start(async () => null)).toBeNull();
});

test("failed login releases the next attempt", async () => {
  const logins = createLoginController();
  await expect(
    logins.start(async () => {
      throw new Error("denied");
    }),
  ).rejects.toThrow("denied");
  expect(await logins.start(async () => null)).toBeNull();
});
