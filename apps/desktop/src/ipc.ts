import { t } from "./i18n";
import type { SoundKind } from "../shared/ui-sounds";
import type {
  Workspace,
  WorkspaceAction,
  WorkspaceRegistry,
  AuthStatus,
  AuthSettingsField,
  MarketplaceAction,
  MarketplaceView,
  CommandCatalog,
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
  workspace?: string;
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
  workspace?: Workspace;
  supportsWorkspaces?: boolean;
  defaultWorkspaceId?: string;
  workspaces?: Service[];
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
  workspace?: string;
  credential?: string;
  secret?: string;
  method?: "browser";
  target?: string;
};
export type Api = {
  setLocale: { input: { locale: "en" | "ko" | "ja" }; output: null };
  workspaceAction: { input: WorkspaceAction; output: WorkspaceRegistry };
  plugins: { input: undefined; output: MarketplaceView };
  pluginAction: { input: MarketplaceAction; output: { message: string } };
  commands: { input: { service: string; live?: boolean }; output: CommandCatalog };
  status: { input: undefined; output: Status };
  services: { input: undefined; output: Service[] };
  start: { input: undefined; output: null };
  stop: { input: undefined; output: null };
  reset: { input: undefined; output: null };
  login: { input: AuthInput; output: null | { cancelled: true } };
  logout: { input: AuthInput; output: null };
  authConfig: {
    input: { service: string; workspace?: string; configuration: Record<string, unknown> };
    output: Authentication;
  };
  authOptions: {
    input: {
      service: string;
      workspace?: string;
      path: string[];
      configuration: Record<string, unknown>;
    };
    output: { value: string; label: string }[];
  };
  authStatus: { input: { service: string; workspace?: string }; output: Authentication };
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
  if (!window.tiny) return Promise.reject(new Error(t("tinyjs에서 앱을 실행해 주세요.")));
  return window.tiny.api.call(method, input) as Promise<Api[K]["output"]>;
};

export const workspaceRows = (services: Service[] | undefined): Service[] =>
  services?.flatMap(
    (service) =>
      service.workspaces?.map((workspace) => ({
        ...workspace,
        defaultWorkspaceId: service.defaultWorkspaceId,
      })) ?? [service],
  ) ?? [];
