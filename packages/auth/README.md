# Credential locking

`withFileLock` prefers the OS `flock` implementation when available.
The fallback uses a local lock file containing its owner's PID and a unique token.
It supports cooperating clients on one machine, not a shared network filesystem.

All fallback creation, stale recovery, and release operations acquire an exclusive
`<lock path>.guard` directory first. Only the guard holder can change the lock file.
The guarded section ends before the caller's protected operation starts.
This prevents one waiter from moving or removing another waiter's new lock.

The fallback recovers a lock only when both conditions hold:

- Its age exceeds `staleMs`.
- Probing the recorded PID confirms that the process does not exist.

A living process keeps its lock even if it pauses longer than `staleMs`.
PID reuse, permission errors, malformed ownership, and unknown liveness preserve the lock.
The fallback does not depend on heartbeat timers to keep an active lock safe.
The kernel path retains automatic OS lock release when its process exits.

## Recovery limits

If a process exits inside the short guarded section, the guard can remain on disk.
Waiters time out with its path instead of deleting it based on age.
Before manually removing a guard or an unidentifiable lock, stop all clients that
use that credential directory, including CLI commands, desktop apps, and daemons.
Keep a backup of existing credentials; recovery does not require deleting token files.

Update fallback clients together. Older clients do not honor the transition guard.
Do not run older fallback implementations concurrently with the updated version.

Tests force the fallback even on systems with `flock`. They cover stale-lock races,
live owners with old timestamps, independent processes, exceptions, owner death,
unknown ownership, and an interrupted guard.
