import { soundDescriptions, type SoundKind } from "./ui-sounds";

type SoundPorts = {
  play(kind: SoundKind): Promise<boolean>;
  now?: () => number;
};

export const createSoundController = (ports: SoundPorts, enabled = true) => {
  const now = ports.now ?? (() => performance.now());
  let revision = 0;
  let activeUntil = 0;
  let lastHover: number | undefined;
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
    activeUntil = Math.max(activeUntil, requestedAt + soundDescriptions[kind].durationMs);
    return ports
      .play(kind)
      .catch(() => false)
      .then((played) => enabled && requestedRevision === revision && played);
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
