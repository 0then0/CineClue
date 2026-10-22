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
// Function words may differ between remembered and catalog titles. Keep exact
// phrase matching first, but require all meaningful words before fuzzy ranking.
const stopWords = new Set([
  "и",
  "а",
  "о",
  "об",
  "обо",
  "в",
  "во",
  "на",
  "по",
  "с",
  "со",
  "у",
  "к",
  "ко",
  "из",
  "от",
  "за",
  "для",
  "a",
  "an",
  "the",
  "of",
  "and",
  "in",
  "on",
  "at",
  "to",
  "with",
  "for",
]);
function words(s: string) {
  return s.split(" ").filter((word) => word && !stopWords.has(word));
}
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
    ].map((s) => ({ s, words: words(s), grams: grams(s) })),
  }));
  return (query: string, limit = 10): PublicMovie[] => {
    const q = normalize(query);
    if (q.length < 2) return [];
    const g = grams(q);
    const queryWords = [...new Set(words(q))];
    const lastWord = q.split(" ").at(-1);
    function score(n: (typeof rows)[number]["names"][number]) {
      if (n.s === q) return 10;
      if (n.s.startsWith(q)) return 8;
      if (n.s.includes(q)) return 6;
      // The final word may still be being typed. Match within a single title,
      // never by combining words from unrelated translations or aliases.
      if (
        queryWords.length &&
        queryWords.every((word) =>
          n.words.some(
            (candidate) => candidate === word || (word === lastWord && candidate.startsWith(word)),
          ),
        )
      ) {
        return 4 + queryWords.length / Math.max(queryWords.length, n.words.length);
      }
      if (q.length < 3) return 0;
      return (2 * [...g].filter((t) => n.grams.has(t)).length) / (g.size + n.grams.size);
    }
    return rows
      .map((r) => ({
        m: r.m,
        score: Math.max(...r.names.map(score)),
      }))
      .filter((r) => r.score >= 0.28)
      .sort((a, b) => b.score - a.score || b.m.popularityScore - a.m.popularityScore)
      .slice(0, limit)
      .map((r) => publicMovie(r.m));
  };
}
