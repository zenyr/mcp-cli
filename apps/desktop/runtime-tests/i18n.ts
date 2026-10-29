import { catalogs, resolveLocale, translate, type MessageKey } from "../shared/i18n";
import { equal, type RuntimeCase } from "./contract";

export const i18nCases: RuntimeCase[] = [
  {
    name: "language detection accepts regional system locales and falls back to English",
    run: async () => {
      for (const value of ["ko-KR", "KO_kr", "ko"]) equal(resolveLocale(value), "ko");
      for (const value of ["ja-JP", "ja"]) equal(resolveLocale(value), "ja");
      for (const value of ["en-US", "fr-FR", "", null, undefined])
        equal(resolveLocale(value), "en");
    },
  },
  {
    name: "all languages provide the same messages and interpolation parameters",
    run: async () => {
      const keys = Object.keys(catalogs.ko).sort();
      for (const catalog of Object.values(catalogs)) {
        equal(Object.keys(catalog).sort(), keys);
        for (const key of Object.keys(catalogs.ko) as MessageKey[]) {
          equal(catalog[key].length > 0, true);
          equal(
            catalog[key].match(/\{\w+\}/g)?.sort() ?? [],
            catalogs.ko[key].match(/\{\w+\}/g)?.sort() ?? [],
          );
        }
      }
    },
  },
  {
    name: "localized sentences preserve counts, names, and literal replacement characters",
    run: async () => {
      equal(translate("en", "열린 연결 {count}개", { count: 2 }), "2 open connections");
      equal(translate("ko", "{count}초 전", { count: 0 }), "0초 전");
      equal(translate("ja", "{count}초", { count: 5 }), "5秒");
      equal(translate("en", "{service}에서 로그아웃할까요?", { service: "$&" }), "Sign out of $&?");
      equal(translate("ja", "설정"), "設定");
    },
  },
];
