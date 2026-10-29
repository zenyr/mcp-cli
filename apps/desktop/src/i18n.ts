import { useSyncExternalStore } from "react";
import { resolveLocale, translate, type Locale, type MessageKey } from "../shared/i18n";

const readLocale = (): Locale => {
  try {
    return resolveLocale(localStorage.getItem("mcp-cli.locale") ?? navigator.language);
  } catch {
    return resolveLocale(navigator.language);
  }
};
let locale = readLocale();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const setLocale = (value: Locale) => {
  localStorage.setItem("mcp-cli.locale", value);
  locale = value;
  document.documentElement.lang = value;
  for (const listener of listeners) listener();
};
export const useLocale = () => useSyncExternalStore(subscribe, () => locale);
export const t = (key: MessageKey, values: Record<string, string | number> = {}): string =>
  translate(locale, key, values);
document.documentElement.lang = locale;
