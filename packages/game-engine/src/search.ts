import type { Movie, PublicMovie } from "./model.ts";
import { publicMovie } from "./model.ts";
export const normalize = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function grams(s: string) {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}
export function createSearch(movies: Movie[]) {
  const rows = movies.map((m) => ({
    m,
    names: [
      ...new Set(
        [m.title, m.originalTitle, ...Object.values(m.titles), ...m.aliases].map(normalize),
      ),
    ].map((s) => ({ s, grams: grams(s) })),
  }));
  return (query: string, limit = 10): PublicMovie[] => {
    const q = normalize(query);
    if (q.length < 2) return [];
    const g = grams(q);
    return rows
      .map((r) => ({
        m: r.m,
        score: Math.max(
          ...r.names.map((n) =>
            n.s === q
              ? 10
              : n.s.startsWith(q)
                ? 8
                : n.s.includes(q)
                  ? 6
                  : q.length < 3
                    ? 0
                    : (2 * [...g].filter((t) => n.grams.has(t)).length) / (g.size + n.grams.size),
          ),
        ),
      }))
      .filter((r) => r.score >= 0.28)
      .sort((a, b) => b.score - a.score || b.m.popularityScore - a.m.popularityScore)
      .slice(0, limit)
      .map((r) => publicMovie(r.m));
  };
}
