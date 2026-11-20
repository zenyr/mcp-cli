import { errorBrand, hasErrorBrand } from "./error-brand";

const authRequiredBrand = errorBrand("AuthRequiredError");

/** How a service authenticates; plugins declare it and the CLI wires credentials at run time. */
export type AuthSpec =
  | {
      type: "oauth";
      scopes?: string[];
      clientName?: string;
      /** Pre-registered client; dynamic client registration runs when omitted. */
      clientId?: string;
      /** Fixed loopback port for servers that require an exact pre-registered redirect URI. */
      redirectPort?: number;
    }
  | {
      type: "apiKey";
      env: string;
      header?: string;
      scheme?: string;
      /** Other keys for the same service, chosen per run with `--<flag>`. */
      alternates?: ApiKeyAlternate[];
    }
  | { type: "none" };
/** A second credential such as a bot token; `summary` appears in help next to `--<flag>`. */
export type ApiKeyAlternate = { flag: string; env: string; summary: string; base?: boolean };
export type OAuthSpec = Extract<AuthSpec, { type: "oauth" }>;
export type ApiKeySpec = Extract<AuthSpec, { type: "apiKey" }>;

/** Stored credentials; `client` is opaque data the connection implementation needs to refresh. */
export type Tokens = {
  accessToken: string;
  /** Stable local cache partition retained across token refresh, replaced by a new login. */
  cacheIdentity?: string;
  tokenType?: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  scope?: string;
  client?: Record<string, unknown>;
};

/** Per-service credential storage with a cross-process lock around read-modify-write sequences. */
export type TokenStore = {
  read(service: string): Promise<Tokens | undefined>;
  write(service: string, tokens: Tokens): Promise<void>;
  delete(service: string): Promise<void>;
  withLock<T>(service: string, fn: () => Promise<T>): Promise<T>;
};

/** Credentials are missing, expired without refresh, or rejected; the CLI exits with status 1. */
export class AuthRequiredError extends Error {
  override name = "AuthRequiredError";
  readonly [authRequiredBrand] = true;
  static [Symbol.hasInstance] = (value: unknown): boolean =>
    hasErrorBrand(value, authRequiredBrand);
}

/** Selects which stored credential the suggested `mcp-cli login` command writes. */
export type LoginTarget = {
  workspace?: string;
  credential?: string;
  browser?: boolean;
  /** Plugin-defined target flag, such as `mcp` or `web`. */
  target?: string;
};

export const loginCommandText = (service: string, target: LoginTarget = {}): string =>
  [
    `mcp-cli login ${service}`,
    target.workspace && `-w ${target.workspace}`,
    target.credential && `--${target.credential}`,
    target.browser && "--browser",
    target.target && `--${target.target}`,
  ]
    .filter(Boolean)
    .join(" ");

export const loginRequired = (
  service: string,
  reason: string,
  target?: LoginTarget,
): AuthRequiredError =>
  new AuthRequiredError(`${reason}. Run ${loginCommandText(service, target)}`);

/** Credential store entry for a service, or for one of its alternate keys. */
export const credentialName = (service: string, credential?: string): string =>
  credential ? `${service}--${credential}` : service;

export const credentialSwitches = (auth: AuthSpec | undefined): ApiKeyAlternate[] =>
  auth?.type === "apiKey" ? (auth.alternates ?? []) : [];
