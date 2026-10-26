export const errorBrand = (name: string): symbol => Symbol.for(`mcp-cli.error.${name}`);
export const hasErrorBrand = (value: unknown, brand: symbol): boolean =>
  typeof value === "object" && value !== null && Reflect.get(value, brand) === true;
