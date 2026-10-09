export type Env = Record<string, string | undefined>;
export type Kind = "user" | "talk" | "tool" | "echo" | "note";
export type Scope = { id: string; name: string; kind: "global" | "project" };
export type Entry = {
  scope: string;
  i: number;
  kind: Kind;
  text: string;
  date: string;
  receipt: string;
};
export type Part = { l: number; i: number };
export type Node = Part & { text: string };
export type Compression = { source: string; context: string; merge: boolean; targetBytes: number };
export type SummaryResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  usageKnown?: boolean;
};
export type Compressor = (input: Compression) => Promise<SummaryResult>;
export type Settings = {
  model: string;
  baseUrl: string;
  nodeBytes: number;
  contextBytes: number;
  inputBytes: number;
  timeoutMs: number;
};
export type ScopeStatus = Scope & {
  messages: number;
  nodes: number;
  pending: number;
  lastError: string | null;
};
export type Store = {
  scope: (scope: Scope) => void;
  entries: (scope: string, before?: number) => Entry[];
  append: (scope: string, kind: Kind, text: string, receipt: string) => Entry;
  nodes: (scope: string, generation: string) => Node[];
  publish: (
    scope: string,
    generation: string,
    owner: string,
    node: Node,
    usage: SummaryResult,
  ) => void;
  recordUsage: (scope: string, generation: string, usage: SummaryResult) => void;
  claim: (scope: string, generation: string, owner: string) => void;
  renew: (scope: string, generation: string, owner: string) => void;
  release: (scope: string, generation: string, owner: string) => void;
  failed: (scope: string, generation: string, owner: string, message: string) => void;
  status: (scopes: Scope[], generation: string) => ScopeStatus[];
  usage: () => {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    unmeasuredCalls: number;
  };
  close: () => void;
};
