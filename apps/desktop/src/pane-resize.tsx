import { useRef } from "react";
import { paneWidth } from "./pane-width";

export const PaneResizeHandle = ({
  width,
  label,
  onResize,
}: {
  width: number;
  label: string;
  onResize: (width: number) => void;
}) => {
  const drag = useRef<{ x: number; width: number }>(undefined);
  return (
    <div
      className="pane-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) onResize(start.width + event.clientX - start.x);
      }}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={(event) => {
        if (drag.current) onResize(drag.current.width);
        drag.current = undefined;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={() => onResize(paneWidth.initial)}
      onKeyDown={(event) => {
        const delta =
          event.key === "ArrowLeft"
            ? -paneWidth.step
            : event.key === "ArrowRight"
              ? paneWidth.step
              : 0;
        if (!delta) return;
        event.preventDefault();
        onResize(width + delta);
      }}
    />
  );
};
