import { Schema } from "effect";
import { UsageError } from "@mcp-cli/core";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048));
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
const Identifier = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9.-]{0,127}$/));
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const Artifact = Schema.Struct({
  url: Text,
  sha256: Hash,
  platform: Schema.Literals(["any", "darwin", "linux", "win32"]),
  arch: Schema.Literals(["any", "arm64", "x64"]),
});
export const Permissions = Schema.Struct({
  localCode: Schema.Boolean,
  network: Schema.Array(Text),
  filesystem: Schema.Array(Text),
});
export const PluginMetadata = Schema.Struct({
  id: Identifier,
  service: Name,
  name: Text,
  description: Text,
  version: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/)),
  permissions: Permissions,
});
export const CatalogPlugin = Schema.Struct({
  ...PluginMetadata.fields,
  artifacts: Schema.NonEmptyArray(Artifact),
});
export const Revocation = Schema.Struct({ id: Identifier, sha256: Hash, reason: Text });
export const Catalog = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: Text,
  plugins: Schema.Array(CatalogPlugin),
  revoked: Schema.optional(Schema.Array(Revocation)),
});
const Auth = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({
    type: Schema.Literal("apiKey"),
    env: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
    header: Schema.optional(Text),
    scheme: Schema.optional(Text),
  }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    scopes: Schema.optional(Schema.Array(Text)),
    clientName: Schema.optional(Text),
    clientId: Schema.optional(Text),
  }),
]);
const ManagedRuntime = Schema.Struct({
  kind: Schema.Literal("managed"),
  id: Identifier,
  artifacts: Schema.NonEmptyArray(Artifact),
  executable: Text,
});
const Server = Schema.Union([
  Schema.Struct({ type: Schema.Literal("http"), url: Text }),
  Schema.Struct({
    type: Schema.Literal("stdio"),
    entry: Text,
    runtime: Schema.Union([Schema.Literal("bun"), Schema.Literal("native"), ManagedRuntime]),
    args: Schema.optional(Schema.Array(Schema.String)),
  }),
]);
export const PackageManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ...PluginMetadata.fields,
  commands: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        path: Schema.Array(Name),
        summary: Schema.optional(Text),
        details: Schema.optional(Text),
        examples: Schema.optional(Schema.Array(Text)),
        rules: Schema.optional(Schema.Array(Text)),
        optional: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  groups: Schema.optional(Schema.Record(Schema.String, Text)),
  quickstart: Schema.optional(Schema.Array(Schema.Struct({ command: Text, summary: Text }))),
  implementation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), entry: Text }),
    Schema.Struct({ type: Schema.Literal("mcp"), server: Server, auth: Schema.optional(Auth) }),
  ]),
});
export const Source = Schema.Struct({
  id: Identifier,
  url: Text,
  commit: Schema.String,
  catalog: Catalog,
});
export const Installed = Schema.Struct({
  key: Hash,
  sourceId: Identifier,
  commit: Schema.String,
  metadata: CatalogPlugin,
  artifact: Artifact,
  manifest: PackageManifest,
  enabled: Schema.Boolean,
  developmentPath: Schema.optional(Text),
  runtime: Schema.optional(Schema.Struct({ sha256: Hash, executable: Text })),
});
export const State = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sources: Schema.Array(Source),
  installed: Schema.Array(Installed),
  commands: Schema.optional(
    Schema.Struct({
      directory: Text,
      launcher: Schema.Array(Text),
      receipts: Schema.Record(Schema.String, Schema.String),
    }),
  ),
});
export type Catalog = typeof Catalog.Type;
export type CatalogPlugin = typeof CatalogPlugin.Type;
export type Artifact = typeof Artifact.Type;
export type PackageManifest = typeof PackageManifest.Type;
export type Source = typeof Source.Type;
export type Installed = typeof Installed.Type;
export type State = typeof State.Type;

export const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
  label: string,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);
  } catch {
    throw new UsageError(`Invalid ${label}; check the marketplace schema.`);
  }
};

export const selectArtifact = (
  artifacts: readonly Artifact[],
  platform = process.platform,
  arch = process.arch,
): Artifact => {
  const matching = artifacts.filter(
    (item) =>
      (item.platform === "any" || item.platform === platform) &&
      (item.arch === "any" || item.arch === arch),
  );
  const ranked = matching.map((artifact) => ({
    artifact,
    score: Number(artifact.platform !== "any") + Number(artifact.arch !== "any"),
  }));
  ranked.sort((a, b) => b.score - a.score);
  if (!ranked[0]) throw new UsageError(`This plugin does not support ${platform}/${arch}.`);
  if (ranked[1]?.score === ranked[0].score) throw new UsageError("Ambiguous platform artifacts.");
  return ranked[0].artifact;
};
