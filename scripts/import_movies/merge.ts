import type { Entity, Movie } from "../../packages/game-engine/src/index.ts";
export type IdentityMap = Record<string, string>;
const fields = ["actors", "directors", "genres", "studios", "countries"] as const;
function entities(values: Entity[]): Entity[] {
  const result = new Map<string, Entity>();
  for (const value of values) {
    const previous = result.get(value.id);
    result.set(
      value.id,
      previous ? { ...previous, names: { ...value.names, ...previous.names } } : value,
    );
  }
  return [...result.values()];
}
function combine(previous: Movie, next: Movie): Movie {
  const merged = {
    ...previous,
    titles: { ...next.titles, ...previous.titles },
    aliases: [...new Set([...previous.aliases, ...next.aliases, next.title, next.originalTitle])],
    externalIds: { ...next.externalIds, ...previous.externalIds },
    provenance: [
      ...new Map(
        [...previous.provenance, ...next.provenance].map((p) => [
          `${p.provider}:${p.url}:${p.retrievedAt}`,
          p,
        ]),
      ).values(),
    ],
  };
  for (const field of fields) {
    const values = entities([...previous[field], ...next[field]]);
    merged[field] = field === "actors" ? values.slice(0, 8) : values;
  }
  return merged;
}
export function mergeMovies(input: Movie[], identities: IdentityMap = {}): Movie[] {
  // Only explicit IDs establish identity; names and years cannot identify remakes or people.
  const movies = new Map<string, Movie>();
  const external = new Map<string, string>();
  for (const original of input) {
    const m = { ...original, id: identities[original.id] ?? original.id };
    for (const field of fields)
      m[field] = entities(m[field].map((e) => ({ ...e, id: identities[e.id] ?? e.id })));
    const keys = Object.entries(m.externalIds).map(([key, value]) => `${key}:${value}`);
    const related = [
      ...new Set([
        ...(movies.has(m.id) ? [m.id] : []),
        ...keys.flatMap((key) => {
          const id = external.get(key);
          return id ? [id] : [];
        }),
      ]),
    ];
    const id = related[0] ?? m.id;
    let merged: Movie | undefined;
    for (const match of related) {
      const previous = movies.get(match);
      if (previous) merged = merged ? combine(merged, previous) : previous;
      movies.delete(match);
    }
    merged = merged ? combine(merged, m) : m;
    movies.set(id, { ...merged, id });
    // A bridging record may join two previously separate provider records.
    if (related.length > 1)
      for (const [key, value] of external) if (related.includes(value)) external.set(key, id);
    for (const key of Object.entries(merged.externalIds).map(
      ([provider, value]) => `${provider}:${value}`,
    ))
      external.set(key, id);
  }
  return [...movies.values()].sort((a, b) => a.id.localeCompare(b.id));
}
