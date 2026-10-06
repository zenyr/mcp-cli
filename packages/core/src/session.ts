/** A concrete resource the server lists under `resources/list`. */
export type ResourceDefinition = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};
/** A parameterized resource URI (RFC 6570) the server lists under `resources/templates/list`. */
export type ResourceTemplateDefinition = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};
/** One item of a `resources/read` result; binary data stays base64 encoded in `blob`. */
export type ResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };
export type PromptArgumentDefinition = {
  name: string;
  description?: string;
  required?: boolean;
};
export type PromptDefinition = {
  name: string;
  title?: string;
  description?: string;
  arguments: PromptArgumentDefinition[];
};
export type PromptMessage = {
  role: "user" | "assistant";
  content: Record<string, unknown>;
};
export type PromptResult = {
  description?: string;
  messages: PromptMessage[];
};
/** Resource and prompt operations a session fetches from the server at run time. */
export type CatalogSession = {
  listResources(): Promise<ResourceDefinition[]>;
  listResourceTemplates(): Promise<ResourceTemplateDefinition[]>;
  readResource(uri: string): Promise<ResourceContent[]>;
  listPrompts(): Promise<PromptDefinition[]>;
  getPrompt(name: string, args: Record<string, string>): Promise<PromptResult>;
};
