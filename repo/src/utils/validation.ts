export function buildFieldsParam(fields: readonly string[]): string {
  return fields.join(",");
}

export function pickKeys<T extends Record<string, unknown>, K extends string>(
  obj: T,
  keys: readonly K[],
): Record<K, unknown> {
  const out = {} as Record<K, unknown>;
  for (const key of keys) {
    out[key] = obj[key];
  }
  return out;
}
