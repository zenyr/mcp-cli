import { cliExitFailure, startDeadline } from "../shared/cli-exit";
import { deferred, equal, type RuntimeCase } from "./contract";

export const cliExitCases: RuntimeCase[] = [
  {
    name: "CLI exit succeeds only with status 0 and no terminating signal",
    run: async () => {
      equal(cliExitFailure({ exit_status: 0, term_signal: null }, ""), undefined);
      equal(cliExitFailure({ exit_status: 2, term_signal: null }, " denied\n"), "denied");
      equal(cliExitFailure({ exit_status: 2, term_signal: null }, ""), "CLI exited with 2");
    },
  },
  {
    name: "CLI killed by a signal fails even when TxikiJS reports exit status 0",
    run: async () => {
      equal(
        cliExitFailure({ exit_status: 0, term_signal: "SIGTERM" }, undefined),
        "CLI was terminated by SIGTERM",
      );
      equal(cliExitFailure({ exit_status: 0, term_signal: "SIGKILL" }, "partial\n"), "partial");
    },
  },
  {
    name: "CLI deadline reports a timeout instead of stderr or a null result",
    run: async () => {
      equal(
        cliExitFailure({ exit_status: 0, term_signal: "SIGTERM" }, "", 10_000),
        "CLI timed out after 10s",
      );
      equal(
        cliExitFailure({ exit_status: 1, term_signal: null }, "cancelled", 300_000),
        "CLI timed out after 300s",
      );
    },
  },
  {
    name: "CLI deadline records expiry when it terminates the child",
    run: async () => {
      const killed = deferred();
      const signals: string[] = [];
      const deadline = startDeadline(
        {
          kill: (signal) => {
            signals.push(signal);
            killed.resolve();
          },
        },
        0,
      );
      equal(deadline.expired(), false);
      await killed.promise;
      equal({ expired: deadline.expired(), signals }, { expired: true, signals: ["SIGTERM"] });
    },
  },
];
