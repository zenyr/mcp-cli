import { sessionToolCases } from "./session-tools";
import { i18nCases } from "./i18n";
import { controllerCases } from "./controllers";
import { effectCases } from "./effect";
import { sembleOutputCases } from "./semble-output";

export const runtimeCases = [
  ...controllerCases,
  ...sessionToolCases,
  ...effectCases,
  ...i18nCases,
  ...sembleOutputCases,
];
