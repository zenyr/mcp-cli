import { expect, test } from "bun:test";
import { sidebarSize } from "../src/sidebar-size";

test("an open sidebar collapses during the drag without squeezing its contents", () => {
  expect([168, 140, 120, 119, 80, 8].map((width) => sidebarSize(true, width))).toEqual([
    { opened: true, width: 168 },
    { opened: true, width: 168 },
    { opened: true, width: 168 },
    { opened: false, width: 8 },
    { opened: false, width: 8 },
    { opened: false, width: 8 },
  ]);
});

test("a short outward drag opens the sidebar and stays open on release", () => {
  expect([8, 24, 32, 48, 80, 110].map((width) => sidebarSize(false, width))).toEqual([
    { opened: false, width: 8 },
    { opened: false, width: 8 },
    { opened: true, width: 168 },
    { opened: true, width: 168 },
    { opened: true, width: 168 },
    { opened: true, width: 168 },
  ]);
  expect(sidebarSize(false, 240)).toEqual({ opened: true, width: 240 });
});
