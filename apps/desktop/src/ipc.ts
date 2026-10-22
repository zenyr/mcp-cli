import type { SoundKind } from "../shared/ui-sounds";

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
  name: string;
  summary: string;
  auth: "none" | "oauth" | "apiKey";
  credentials: { flag: string; summary: string; stored: boolean; fromEnv: boolean }[];
};
export type Settings = { cliCommand: string[]; autoStart: boolean; soundsEnabled: boolean };
export type AuthInput = { service: string; credential?: string; secret?: string };
export type Api = {
  status: { input: undefined; output: Status };
  services: { input: undefined; output: Service[] };
  start: { input: undefined; output: null };
  stop: { input: undefined; output: null };
  reset: { input: undefined; output: null };
  login: { input: AuthInput; output: null | { cancelled: true } };
  logout: { input: AuthInput; output: null };
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
