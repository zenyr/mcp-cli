import { sessionToolCases } from "./session-tools";
import { i18nCases } from "./i18n";
import { controllerCases } from "./controllers";
import { effectCases } from "./effect";
import { sembleOutputCases } from "./semble-output";
import { cliExitCases } from "./cli-exit";
import { updateRequestCases } from "./update-request";

export const runtimeCases = [
  ...controllerCases,
  ...updateRequestCases,
  ...sessionToolCases,
  ...effectCases,
  ...i18nCases,
  ...sembleOutputCases,
  ...cliExitCases,
];
