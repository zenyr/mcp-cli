import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SoundKind } from "../shared/ui-sounds";
import { call } from "./ipc";

export const useSettings = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: () => call("settings"),
    staleTime: 30_000,
    retry: false,
  });
export const playUiSound = (kind: SoundKind) => {
  void call("sound", { kind }).catch(() => undefined);
};
const controlFor = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  const control = target.closest('button, a[href], [role="button"]');
  if (
    !control ||
    control.matches(':disabled, [aria-disabled="true"]') ||
    control.closest('[data-sfx="off"]')
  )
    return null;
  return control;
};
export const useInteractionSounds = () => {
  const { data } = useSettings();
  useEffect(() => {
    if (data?.soundsEnabled !== true) return;
    let lastHover = -Infinity;
    const hover = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const control = controlFor(event.target);
      if (
        !control ||
        (event.relatedTarget instanceof Node && control.contains(event.relatedTarget))
      )
        return;
      const now = performance.now();
      if (now - lastHover < 180) return;
      lastHover = now;
      playUiSound("hover");
    };
    const click = (event: MouseEvent) => {
      if (controlFor(event.target)) playUiSound("click");
    };
    document.addEventListener("pointerover", hover, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerover", hover, true);
      document.removeEventListener("click", click, true);
    };
  }, [data?.soundsEnabled]);
};
