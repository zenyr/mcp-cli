import { expect, test } from "bun:test";
import { renderIcon } from "../scripts/icon-render";

const source = await Bun.file(new URL("../assets/mcp-cli.svg", import.meta.url)).text();

for (const palette of ["template", "color"] as const) {
  test(`${palette} tray dims only MCP to 50% while the prompt remains opaque`, () => {
    const running = renderIcon(source, { palette, state: "running", width: 216 });
    const stopped = renderIcon(source, { palette, state: "stopped", width: 216 });
    let prefixPixels = 0;
    let mcpPixels = 0;
    for (let offset = 0; offset < running.pixels.length; offset += 4) {
      if (running.pixels[offset + 3] !== 255) continue;
      const pixel = offset / 4;
      const isPrefix = pixel % running.width < 80 && Math.floor(pixel / running.width) > 145;
      const alpha = isPrefix ? 255 : 128;
      expect(stopped.pixels[offset + 3]).toBe(alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const before = running.pixels[offset + channel] ?? 0;
        const after = stopped.pixels[offset + channel] ?? 0;
        expect(Math.abs((after * 255) / alpha - before)).toBeLessThanOrEqual(1);
        if (palette === "template") expect(before).toBe(0);
      }
      if (isPrefix) prefixPixels += 1;
      else mcpPixels += 1;
    }
    expect(prefixPixels).toBeGreaterThan(100);
    expect(mcpPixels).toBeGreaterThan(1000);
  });
}

test("app icon renders as a square 1024px PNG with transparent padding", () => {
  const icon = renderIcon(source, { palette: "color", state: "running", width: 1024 });
  expect([icon.width, icon.height]).toEqual([1024, 1024]);
  expect([...icon.png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(icon.pixels[3]).toBe(0);
  expect(icon.pixels[icon.pixels.length - 1]).toBe(0);
});
