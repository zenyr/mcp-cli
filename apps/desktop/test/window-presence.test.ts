import { expect, test } from "bun:test";
import { showManagementWindow, syncWindowPresence } from "../backend/window-presence";

test("window presence follows close, reopen, and minimize", async () => {
  let state = { visible: false, minimized: false };
  const changes: string[] = [];
  const app = {
    presence: (mode: "normal" | "menubar") => changes.push(mode),
    show: () => changes.push("show"),
    getWinState: async () => state,
  };
  showManagementWindow(app);
  await syncWindowPresence(app);
  state = { visible: true, minimized: false };
  showManagementWindow(app);
  await syncWindowPresence(app);
  state = { visible: false, minimized: true };
  await syncWindowPresence(app);
  state = { visible: false, minimized: false };
  await syncWindowPresence(app);
  expect(changes).toEqual(["normal", "show", "menubar", "normal", "show", "menubar"]);
});
