import type { SoundKind } from "../shared/ui-sounds";
import type {
  AuthStatus,
  AuthSettingsField,
  MarketplaceAction,
  MarketplaceView,
} from "@mcp-cli/core";

export type Authentication = {
  configuration: Record<string, unknown>;
  fields: AuthSettingsField[];
  states: AuthStatus[];
};

export type Connection = {
  id: string;
  service: string;
  credential?: string;
  openedAt: number;
  active: number;
  leases: number;
  lastUsed: number;
};
export type Status =
  | {
      online: true;
      status: {
        pid: number;
        startedAt: number;
        address: string;
        idleMs: number;
        connections: Connection[];
      };
    }
  | { online: false; error: string };
export type Service = {
  error?: string;
  name: string;
  summary: string;
  auth: "none" | "oauth" | "apiKey";
  authentication?: Authentication;
  credentials: { flag: string; summary: string; stored: boolean; fromEnv: boolean }[];
};
export type Settings = { cliCommand: string[]; autoStart: boolean; soundsEnabled: boolean };
export type AuthInput = {
  service: string;
  credential?: string;
  secret?: string;
  method?: "browser";
  target?: string;
};
export type Api = {
  plugins: { input: undefined; output: MarketplaceView };
  pluginAction: { input: MarketplaceAction; output: { message: string } };
  status: { input: undefined; output: Status };
  services: { input: undefined; output: Service[] };
  start: { input: undefined; output: null };
  stop: { input: undefined; output: null };
  reset: { input: undefined; output: null };
  login: { input: AuthInput; output: null | { cancelled: true } };
  logout: { input: AuthInput; output: null };
  authConfig: {
    input: { service: string; configuration: Record<string, unknown> };
    output: Authentication;
  };
  authStatus: { input: { service: string }; output: Authentication };
  cancelLogin: { input: undefined; output: null };
  settings: { input: undefined; output: Settings };
  saveSettings: { input: { cliCommand?: string[] | null; autoStart: boolean }; output: null };
  sound: { input: { kind: SoundKind }; output: boolean };
  setSoundsEnabled: { input: { enabled: boolean }; output: null };
};
export const call = <K extends keyof Api>(
  method: K,
  input?: Api[K]["input"],
): Promise<Api[K]["output"]> => {
  if (!window.tiny) return Promise.reject(new Error("tinyjs에서 앱을 실행해 주세요."));
  return window.tiny.api.call(method, input) as Promise<Api[K]["output"]>;
};
