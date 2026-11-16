const TABS = ["overview", "auth", "commands", "diagram"] as const;
export type DetailTab = (typeof TABS)[number];
export type DetailSearch = { tab?: DetailTab; path?: string; source?: string };
export const isTab = (value: unknown): value is DetailTab => TABS.some((tab) => tab === value);
export const parseDetailSearch = (search: Record<string, unknown>): DetailSearch => ({
  ...(isTab(search.tab) && { tab: search.tab }),
  ...(typeof search.path === "string" && search.path && { path: search.path }),
  ...(typeof search.source === "string" && search.source && { source: search.source }),
});
