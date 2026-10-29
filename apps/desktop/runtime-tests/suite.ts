import { i18nCases } from "./i18n";
import { controllerCases } from "./controllers";
import { effectCases } from "./effect";

export const runtimeCases = [...controllerCases, ...effectCases, ...i18nCases];
