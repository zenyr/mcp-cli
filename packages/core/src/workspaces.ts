/** A locally named workspace with a stable storage identity. */
export type Workspace = { id: string; name: string; legacy?: boolean };
export type WorkspaceRegistry = { workspaces: Workspace[]; defaultId?: string };
export type WorkspaceAction =
  | { type: "add"; service: string; name: string }
  | { type: "rename"; service: string; workspace: string; name: string }
  | { type: "default"; service: string; workspace: string };
