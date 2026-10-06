// Matches the compiler's identifier casing so generated names stay stable.
export const pascalCase = (name: string): string =>
  name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")
    .replace(/\d[a-z]/g, (match) => match.toUpperCase());

export const uniqueName = (base: string, used: Set<string>): string => {
  let name = base;
  for (let suffix = 2; used.has(name); suffix++) name = `${base}${suffix}`;
  used.add(name);
  return name;
};

export const withInputTypeNames = <T extends { name: string }>(
  tools: T[],
  used: Set<string>,
): Array<[T, string]> =>
  tools.map((tool) => {
    const base = pascalCase(tool.name);
    return [tool, uniqueName(`${/^[A-Z]/.test(base) ? base : `Tool${base}`}Input`, used)];
  });
