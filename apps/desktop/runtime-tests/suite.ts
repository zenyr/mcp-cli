import { controllerCases } from "./controllers";
import { effectCases } from "./effect";

export const runtimeCases = [...controllerCases, ...effectCases];
