import { trayImages } from "./tray-images";

export const prepareTrayIcon = async (app: DesktopApp) => {
  const isMac = tjs.env.OS !== "Windows_NT" && !/linux/i.test(navigator.platform);
  const variant = isMac ? "template" : "color";
  const path = `${app.paths.cache}/tray-${variant}.png`;
  const bytes = Uint8Array.from(atob(trayImages[variant]), (character) => character.charCodeAt(0));
  await tjs.makeDir(app.paths.cache, { recursive: true });
  await tjs.writeFile(path, bytes);
  return { icon: path, template: isMac };
};
