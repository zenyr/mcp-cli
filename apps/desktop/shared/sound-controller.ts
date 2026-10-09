import { soundDescriptions, type SoundKind } from "./ui-sounds";

type SoundPorts = {
  play(kind: SoundKind): Promise<boolean>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

export const createSoundController = (ports: SoundPorts, enabled = true) => {
  const now = ports.now ?? Date.now;
  const wait = ports.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let revision = 0;
  let activeUntil = 0;
  let lastHover: number | undefined;
  let queue = Promise.resolve(false);
  let daemonObserved = false;
  let daemonPid: number | null = null;
  const play = (kind: SoundKind): Promise<boolean> => {
    const requestedAt = now();
    const requestedRevision = revision;
    if (!enabled) return Promise.resolve(false);
    if (kind === "hover") {
      if (requestedAt < activeUntil || (lastHover !== undefined && requestedAt - lastHover < 180))
        return Promise.resolve(false);
      lastHover = requestedAt;
    }
    queue = queue
      .then(async () => {
        if (!enabled || requestedRevision !== revision) return false;
        const remaining = activeUntil - now();
        if (kind === "hover" && remaining > 0) return false;
        if (remaining > 0) await wait(remaining);
        if (!enabled || requestedRevision !== revision) return false;
        const played = await ports.play(kind).catch(() => false);
        if (played) activeUntil = now() + soundDescriptions[kind].durationMs;
        return played;
      })
      .catch(() => false);
    return queue;
  };
  return {
    play,
    enabled: () => enabled,
    setEnabled: (value: boolean) => {
      if (enabled !== value) revision += 1;
      enabled = value;
    },
    observeDaemon: (pid: number | null) => {
      if (!daemonObserved) {
        daemonObserved = true;
        daemonPid = pid;
        return Promise.resolve(false);
      }
      if (pid === daemonPid) return Promise.resolve(false);
      daemonPid = pid;
      return pid === null ? Promise.resolve(false) : play("start");
    },
  };
};
