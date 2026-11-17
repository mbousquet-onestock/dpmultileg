/**
 * The internal GET routes are not formally documented: depending on the version they answer
 * `{ delivery_routes: [...] }`, `{ delivery_routes: { id: {...} } }` or a raw array.
 * These helpers turn any of these shapes into a list of documents with an `id`.
 */
export function asList<T extends { id: string }>(payload: unknown, ...keys: string[]): T[] {
  let value: unknown = payload;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const key = keys.find((k) => k in obj);
    if (key) value = obj[key];
  }
  if (Array.isArray(value)) return value.map((v) => withId(v)).filter(Boolean) as T[];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([id, v]) => withId(v, id))
      .filter(Boolean) as T[];
  }
  return [];
}

function withId(v: unknown, fallbackId?: string): { id: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = (o.id ?? o._id ?? fallbackId) as string | undefined;
  if (!id) return null;
  return { ...o, id: String(id) };
}

export function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}
