export type CliExit = { exit_status: number; term_signal: string | null };

// TxikiJS reports exit status 0 for signal-killed children, so a terminating signal also fails.
export const cliExitFailure = (
  status: CliExit,
  stderr: string | undefined,
  timedOutAfterMs?: number,
): string | undefined => {
  if (timedOutAfterMs !== undefined) return `CLI timed out after ${timedOutAfterMs / 1000}s`;
  if (status.exit_status === 0 && status.term_signal === null) return undefined;
  return (
    stderr?.trim() ||
    (status.term_signal === null
      ? `CLI exited with ${status.exit_status}`
      : `CLI was terminated by ${status.term_signal}`)
  );
};

export const startDeadline = (child: { kill: (signal: "SIGTERM") => void }, ms: number) => {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    try {
      child.kill("SIGTERM");
    } catch {
      /* The process already exited. */
    }
  }, ms);
  return { expired: () => expired, clear: () => clearTimeout(timer) };
};
