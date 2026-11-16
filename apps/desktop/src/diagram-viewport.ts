export const attachDiagramViewport = (element: HTMLElement) => {
  const svg = element.querySelector("svg");
  let scale = 1;
  let x = 0;
  let y = 0;
  let drag: { id: number; x: number; y: number } | undefined;
  let moved = false;
  const draw = () => {
    if (!svg) return;
    svg.style.transformOrigin = "0 0";
    svg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  if (svg) {
    svg.style.maxWidth = "none";
    svg.style.width = `${svg.getAttribute("width")}px`;
    svg.style.height = `${svg.getAttribute("height")}px`;
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    moved = false;
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    element.setPointerCapture(event.pointerId);
    element.style.cursor = "grabbing";
    x += dx;
    y += dy;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    draw();
  };
  const up = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    element.style.cursor = "grab";
  };
  const click = (event: MouseEvent) => {
    if (!moved) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    moved = false;
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  element.addEventListener("lostpointercapture", up);
  element.addEventListener("click", click, true);
  element.addEventListener("wheel", wheel, { passive: false });
  draw();
  return {
    zoomBy: (factor: number) => {
      const next = Math.min(4, Math.max(0.1, scale * factor));
      const ratio = next / scale;
      x = element.clientWidth / 2 - (element.clientWidth / 2 - x) * ratio;
      y = element.clientHeight / 2 - (element.clientHeight / 2 - y) * ratio;
      scale = next;
      draw();
    },
    reset: () => {
      scale = 1;
      x = 0;
      y = 0;
      draw();
    },
    destroy: () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("lostpointercapture", up);
      element.removeEventListener("click", click, true);
      element.removeEventListener("wheel", wheel);
    },
  };
};
