import { i18nCases } from "./i18n";
import { controllerCases } from "./controllers";
import { effectCases } from "./effect";
import { sembleOutputCases } from "./semble-output";

export const runtimeCases = [
  ...controllerCases,
  ...effectCases,
  ...i18nCases,
  ...sembleOutputCases,
];
