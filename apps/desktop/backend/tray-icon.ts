import { trayImages } from "./tray-images";

export const prepareTrayIcons = async (app: DesktopApp) => {
  const isMac = tjs.env.OS !== "Windows_NT" && !/linux/i.test(navigator.platform);
  const variant = isMac ? "template" : "color";
  await tjs.makeDir(app.paths.cache, { recursive: true });
  const save = async (state: "running" | "stopped") => {
    const path = `${app.paths.cache}/tray-${variant}-${state}.png`;
    const bytes = Uint8Array.from(atob(trayImages[variant][state]), (character) =>
      character.charCodeAt(0),
    );
    await tjs.writeFile(path, bytes);
    return { icon: path, template: isMac };
  };
  return { running: await save("running"), stopped: await save("stopped") };
};
