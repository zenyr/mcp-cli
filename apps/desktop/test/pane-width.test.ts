import { expect, test } from "bun:test";
import { clampPaneWidth } from "../src/pane-width";

test("the command list keeps its minimum width and leaves room for the detail pane", () => {
  expect([60, 140, 260.4, 500, 900].map((width) => clampPaneWidth(width, 800))).toEqual([
    140, 140, 260, 480, 480,
  ]);
  expect(clampPaneWidth(300, 400)).toBe(140);
});
