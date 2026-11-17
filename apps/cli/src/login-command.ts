import { Effect } from "effect";
import { attempt } from "./attempt";
import { defaultStore, loginCommand, logoutCommand, openInBrowser } from "./auth";
import { resetDaemonIfRunning } from "./daemon/client";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { CliHost } from "./host";
import { defaultContext } from "./paths";

/** The `login` and `logout` commands against the host's environment, stdin and stderr. */
export const credentialCommand = (
  command: "login" | "logout",
  args: string[],
): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const writeError = (text: string) => host.writeError(`${text}\n`);
    const run = command === "login" ? loginCommand : logoutCommand;
    yield* attempt(() =>
      run(args, {
        env: host.env,
        store: defaultStore(host.env),
        plugin: async (name) => {
          const registry = await discover(await defaultContext(host.env));
          return loadPlugin(findPlugin(registry, name), registry.context);
        },
        writeError,
        open: openInBrowser(writeError, host.stderrIsTTY === true),
        manual: host.onStdinLine,
        readSecret: host.readSecret,
      }),
    );
    yield* attempt(resetDaemonIfRunning);
  });
