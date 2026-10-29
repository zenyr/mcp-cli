import { messages as ko } from "./i18n/messages-ko";
import { messages as en } from "./i18n/messages-en";
import { messages as ja } from "./i18n/messages-ja";

export type Locale = "en" | "ko" | "ja";
export type MessageKey = keyof typeof ko;
export const catalogs = { en, ko, ja };
export const resolveLocale = (value: string | null | undefined): Locale => {
  const language = value?.toLowerCase().split(/[-_]/)[0];
  return language === "ko" || language === "ja" ? language : "en";
};
export const translate = (
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string =>
  catalogs[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
