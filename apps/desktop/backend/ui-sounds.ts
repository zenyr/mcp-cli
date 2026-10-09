import { createSoundController } from "../shared/sound-controller";
import { soundDescriptions, soundKinds, type SoundKind } from "../shared/ui-sounds";
import { soundBank } from "./sound-bank";

let controller: Promise<ReturnType<typeof createSoundController>> | undefined;
export const getSoundController = (app: DesktopApp) => {
  controller ??= (async () => {
    await tjs.makeDir(app.paths.cache, { recursive: true });
    const paths: Partial<Record<SoundKind, string>> = {};
    for (const kind of soundKinds) {
      const path = `${app.paths.cache}/ui-${soundDescriptions[kind].id}.wav`;
      await tjs.writeFile(
        path,
        Uint8Array.from(atob(soundBank[kind]), (character) => character.charCodeAt(0)),
      );
      paths[kind] = path;
    }
    return createSoundController(
      {
        play: (kind) => {
          const path = paths[kind];
          return path ? app.playSound(path) : Promise.resolve(false);
        },
      },
      (await app.store.get("soundsEnabled")) !== false,
    );
  })();
  return controller;
};
export const playUiSound = async (app: DesktopApp, kind: SoundKind) => {
  try {
    return await (await getSoundController(app)).play(kind);
  } catch {
    return false;
  }
};
export const observeDaemonSound = async (app: DesktopApp, status: unknown) => {
  const pid =
    typeof status === "object" &&
    status !== null &&
    "pid" in status &&
    typeof status.pid === "number"
      ? status.pid
      : null;
  try {
    await (await getSoundController(app)).observeDaemon(pid);
  } catch {
    /* Audio failure must not change daemon status. */
  }
};
export const setSoundsEnabled = async (app: DesktopApp, enabled: boolean) => {
  const sound = await getSoundController(app);
  const previous = sound.enabled();
  sound.setEnabled(enabled);
  try {
    await app.store.set("soundsEnabled", enabled);
  } catch (error) {
    sound.setEnabled(previous);
    throw error;
  }
};
