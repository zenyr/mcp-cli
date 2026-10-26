import type { Connection } from "./index";
import type { TokenStore } from "./auth";

export type SettingsStore = {
  read(service: string): Promise<Record<string, unknown> | undefined>;
  write(service: string, value: Record<string, unknown>): Promise<void>;
  withLock<T>(service: string, run: () => Promise<T>): Promise<T>;
};
export type AuthSupportContext = {
  env: Record<string, string | undefined>;
  store: TokenStore;
  settings: SettingsStore;
};
export type AuthSelection = { credential?: string; target?: string; method?: string };
export type AuthLoginOptions = AuthSelection & {
  signal?: AbortSignal;
  timeoutMs?: number;
  ui: {
    open(url: string): void | Promise<void>;
    manual?: (submit: (input: string) => void) => () => void;
  };
};
export type AuthStatus = {
  target: string;
  state: "missing" | "configured" | "stored" | "connected" | "expired" | "reauth" | "failed";
  detail: string;
};
export type AuthSettingsField = {
  path: string[];
  label: string;
  description?: string;
  type: "text" | "boolean" | "strings" | "select";
  options?: { value: string; label: string }[];
};
export type AuthSupport = {
  fields?: AuthSettingsField[];
  configure(context: AuthSupportContext, value: unknown): Promise<void>;
  configuration(context: AuthSupportContext): Promise<Record<string, unknown>>;
  status(context: AuthSupportContext, check: boolean): Promise<AuthStatus[]>;
  login(context: AuthSupportContext, options: AuthLoginOptions): Promise<void>;
  logout(context: AuthSupportContext, selection: AuthSelection): Promise<void>;
  resolve(
    context: AuthSupportContext,
    connection: Connection,
    credential?: string,
  ): Promise<Connection | undefined>;
  identity(context: AuthSupportContext, credential?: string): Promise<unknown>;
};
