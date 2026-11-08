const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const firstTypeContent = (structure: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(structure) || !isRecord(structure.types)) return undefined;
  const first = Object.values(structure.types)[0];
  return isRecord(first) ? first : undefined;
};

/** Button labels of a template, in order, read from the provider structure JSON. */
export const templateButtonLabels = (structure: unknown): string[] => {
  const content = firstTypeContent(structure);
  const actions = content?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((action) =>
    isRecord(action) && typeof action.title === "string" ? [action.title] : [],
  );
};
