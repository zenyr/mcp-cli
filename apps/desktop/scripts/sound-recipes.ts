import type { SoundKind } from "../shared/ui-sounds";
import type { SoundRecipe } from "./sound-synthesis";

export const soundRecipes: Record<SoundKind, SoundRecipe> = {
  start: {
    duration: 0.16,
    peak: 0.22,
    pulses: [
      {
        at: 0,
        frequency: 1240,
        decay: 0.03,
        gain: 1,
        soft: true,
      },
      {
        at: 0.035,
        frequency: 2480,
        decay: 0.022,
        gain: 0.24,
      },
    ],
  },
  hover: {
    duration: 0.075,
    peak: 0.105,
    pulses: [
      {
        at: 0,
        frequency: 2120,
        decay: 0.014,
        gain: 1,
        soft: true,
      },
    ],
  },
  click: {
    duration: 0.095,
    peak: 0.18,
    pulses: [
      {
        at: 0,
        frequency: 1540,
        decay: 0.016,
        gain: 1,
        soft: true,
      },
    ],
  },
  success: {
    duration: 0.2,
    peak: 0.24,
    pulses: [
      {
        at: 0,
        frequency: 1810,
        decay: 0.025,
        gain: 0.7,
      },
      {
        at: 0.065,
        frequency: 2715,
        decay: 0.027,
        gain: 1,
      },
    ],
  },
  error: {
    duration: 0.18,
    peak: 0.21,
    pulses: [
      {
        at: 0,
        frequency: 1310,
        decay: 0.02,
        gain: 0.8,
        soft: true,
      },
      {
        at: 0.06,
        frequency: 980,
        decay: 0.022,
        gain: 1,
        soft: true,
      },
    ],
  },
};
