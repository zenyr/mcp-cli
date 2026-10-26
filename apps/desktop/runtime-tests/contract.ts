export type RuntimeCase = { name: string; run: () => void | Promise<void> };

export const equal = (actual: unknown, expected: unknown): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
};

export const rejects = async (task: Promise<unknown>): Promise<void> => {
  const rejected = await task.then(
    () => false,
    () => true,
  );
  if (!rejected) throw new Error("Expected the operation to reject");
};

export const deferred = () => Promise.withResolvers<void>();
