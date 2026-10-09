import { Resvg } from "@resvg/resvg-js";

export type IconPresentation = {
  palette: "color" | "template";
  state: "running" | "stopped";
  width: number;
};

export const renderIcon = (source: string, presentation: IconPresentation) => {
  const opacity = presentation.state === "running" ? "1" : "0.5";
  const colored = source.replace(
    'data-part="mcp" opacity="1"',
    `data-part="mcp" opacity="${opacity}"`,
  );
  const svg =
    presentation.palette === "template"
      ? colored.replace(/stroke="#[\da-f]{6}"/gi, 'stroke="#000000"')
      : colored;
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: presentation.width },
    font: { loadSystemFonts: false },
  }).render();
  return {
    png: rendered.asPng(),
    pixels: rendered.pixels,
    width: rendered.width,
    height: rendered.height,
  };
};
