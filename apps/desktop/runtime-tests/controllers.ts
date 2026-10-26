import { createLoginController } from "../shared/login-controller";
import { createDrainController } from "../shared/drain-controller";
import { createSoundController } from "../shared/sound-controller";
import { soundKinds } from "../shared/ui-sounds";
import { deferred, equal, rejects, type RuntimeCase } from "./contract";

export const controllerCases: RuntimeCase[] = [
  {
    name: "cancel during preparation prevents a late login process",
    run: async () => {
      const logins = createLoginController();
      const preparation = deferred();
      let spawned = false;
      const pending = logins.start(async (signal) => {
        await preparation.promise;
        signal.throwIfAborted();
        spawned = true;
      });
      await logins.cancel();
      equal(await pending, { cancelled: true });
      equal(await logins.start(async () => null), null);
      preparation.resolve();
      await Promise.resolve();
      equal(spawned, false);
    },
  },
  {
    name: "cancel aborts active login and rejects duplicate login",
    run: async () => {
      const logins = createLoginController();
      const started = deferred();
      const stopped = deferred();
      const pending = logins.start(async (signal) => {
        signal.addEventListener("abort", () => stopped.resolve(), { once: true });
        started.resolve();
        await stopped.promise;
        throw new Error("terminated");
      });
      await started.promise;
      await rejects(logins.start(async () => null));
      await logins.cancel();
      equal(await pending, { cancelled: true });
      equal(await logins.start(async () => null), null);
    },
  },
  {
    name: "failed login releases the next attempt",
    run: async () => {
      const logins = createLoginController();
      await rejects(
        logins.start(async () => {
          throw new Error("denied");
        }),
      );
      equal(await logins.start(async () => null), null);
    },
  },
  {
    name: "shutdown rejects new requests and drains accepted writes",
    run: async () => {
      const operations = createDrainController();
      const write = deferred();
      const events: string[] = [];
      const pending = operations.run(async () => {
        await write.promise;
        events.push("saved");
      });
      const drain = operations
        .drain(async () => {
          events.push("cancel-login");
        })
        .then(() => {
          events.push("quit");
        });
      equal(operations.accepting(), false);
      await rejects(operations.run(async () => {}));
      equal(events, ["cancel-login"]);
      write.resolve();
      await pending;
      await drain;
      equal(events, ["cancel-login", "saved", "quit"]);
    },
  },
  {
    name: "failed requests release the shutdown barrier",
    run: async () => {
      const operations = createDrainController();
      const pending = operations.run(async () => {
        throw new Error("request failed");
      });
      const drain = operations.drain(async () => {});
      await rejects(pending);
      await drain;
    },
  },
  {
    name: "mute invalidates pending playback",
    run: async () => {
      const played: string[] = [];
      const completion = Promise.withResolvers<boolean>();
      const control = createSoundController({
        play: (kind) => {
          played.push(kind);
          return completion.promise;
        },
      });
      control.setEnabled(false);
      for (const kind of soundKinds) equal(await control.play(kind), false);
      equal(played, []);
      control.setEnabled(true);
      const pending = control.play("click");
      control.setEnabled(false);
      control.setEnabled(true);
      completion.resolve(true);
      equal(await pending, false);
    },
  },
  {
    name: "click and feedback do not wait for hover playback",
    run: async () => {
      let now = 0;
      const played: { kind: string; at: number }[] = [];
      const control = createSoundController({
        now: () => now,
        play: async (kind) => {
          played.push({ kind, at: now });
          return true;
        },
      });
      equal(await control.play("hover"), true);
      now = 20;
      equal(await control.play("click"), true);
      now = 30;
      equal(await control.play("success"), true);
      equal(await control.play("hover"), false);
      now = 240;
      equal(await control.play("hover"), true);
      equal(played, [
        { kind: "hover", at: 0 },
        { kind: "click", at: 20 },
        { kind: "success", at: 30 },
        { kind: "hover", at: 240 },
      ]);
    },
  },
  {
    name: "startup sound follows new daemon identities",
    run: async () => {
      const played: string[] = [];
      const control = createSoundController({
        now: () => 0,
        play: async (kind) => {
          played.push(kind);
          return true;
        },
      });
      for (const [pid, expected] of [
        [101, false],
        [101, false],
        [null, false],
        [202, true],
        [202, false],
      ] as const)
        equal(await control.observeDaemon(pid), expected);
      equal(played, ["start"]);
      control.setEnabled(false);
      equal(await control.observeDaemon(303), false);
      control.setEnabled(true);
      equal(await control.observeDaemon(303), false);
    },
  },
  {
    name: "audio failures do not poison subsequent playback",
    run: async () => {
      let calls = 0;
      const control = createSoundController({
        play: async () => {
          calls += 1;
          if (calls === 1) throw new Error("device unavailable");
          return true;
        },
      });
      equal(await control.play("click"), false);
      equal(await control.play("success"), true);
    },
  },
];
