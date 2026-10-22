import { z } from "zod";
import type { Entity, Movie } from "./model.ts";

// TMDB's movie genre IDs map to existing canonical IDs so collection rules remain valid.
const definitions = [
  [28, "Q188473", "Action", "Боевик"],
  [12, "Q319221", "Adventure", "Приключения"],
  [16, "Q202866", "Animation", "Анимация"],
  [35, "Q157443", "Comedy", "Комедия"],
  [80, "Q959790", "Crime", "Криминал"],
  [99, "Q93204", "Documentary", "Документальный"],
  [18, "Q130232", "Drama", "Драма"],
  [10751, "Q1361932", "Family", "Семейный"],
  [14, "Q157394", "Fantasy", "Фэнтези"],
  [36, "Q17013749", "History", "Исторический"],
  [27, "Q200092", "Horror", "Ужасы"],
  [10402, "tmdb:genre:10402", "Music", "Музыка"],
  [9648, "Q1200678", "Mystery", "Детектив"],
  [10749, "Q1054574", "Romance", "Мелодрама"],
  [878, "Q471839", "Science Fiction", "Фантастика"],
  [10770, "Q506240", "TV Movie", "Телефильм"],
  [53, "Q2484376", "Thriller", "Триллер"],
  [10752, "Q369747", "War", "Военный"],
  [37, "Q172980", "Western", "Вестерн"],
] as const;
export const baseGenres = new Map<number, Entity>(
  definitions.map(([id, canonical, en, ru]) => [
    id,
    { id: canonical, name: en, names: { en, ru } },
  ]),
);
export const subgenreDefinitions = [
  ["slasher", "Slasher", "Слэшер", ["Q853630"], ["slasher"]],
  ["noir", "Film noir", "Нуар", ["Q185867"], ["film noir"]],
  ["neo-noir", "Neo-noir", "Неонуар", ["Q2421031"], ["neo-noir"]],
  [
    "psychological-thriller",
    "Psychological thriller",
    "Психологический триллер",
    ["Q109733304"],
    ["psychological thriller"],
  ],
  [
    "psychological-drama",
    "Psychological drama",
    "Психологическая драма",
    ["Q63214877"],
    ["psychological drama"],
  ],
  ["coming-of-age", "Coming of age", "История взросления", ["Q102429885"], ["coming of age"]],
  [
    "romantic-comedy",
    "Romantic comedy",
    "Романтическая комедия",
    ["Q860626", "Q118612349"],
    ["romantic comedy"],
  ],
  ["black-comedy", "Black comedy", "Чёрная комедия", ["Q5778924"], ["black comedy", "dark comedy"]],
  ["crime-drama", "Crime drama", "Криминальная драма", ["Q113485322"], ["crime drama"]],
  ["crime-thriller", "Crime thriller", "Криминальный триллер", ["Q19367312"], ["crime thriller"]],
  ["heist", "Heist", "Фильм об ограблении", ["Q496523"], ["heist"]],
  ["spy", "Spy film", "Шпионский фильм", ["Q2297927"], ["spy film", "espionage"]],
  ["gangster", "Gangster film", "Гангстерский фильм", ["Q7444356"], ["gangster film"]],
  ["biographical", "Biographical", "Биографический", ["Q645928"], ["biography", "biopic"]],
  ["musical", "Musical", "Мюзикл", ["Q842256"], ["musical"]],
  ["superhero", "Superhero", "Супергеройский", ["Q1535153"], ["superhero"]],
  ["post-apocalyptic", "Post-apocalyptic", "Постапокалипсис", ["Q1341051"], ["post-apocalyptic"]],
  ["dystopian", "Dystopian", "Антиутопия", ["Q20443008"], ["dystopia"]],
  ["cyberpunk", "Cyberpunk", "Киберпанк", ["Q174526"], ["cyberpunk"]],
] as const;
const keyword = z.object({ name: z.string() });
const rawGenres = z.object({
  genres: z.array(z.object({ id: z.number() })).min(1),
  keywords: z.object({ keywords: z.array(keyword) }).optional(),
});
export function applyGenreProfile(movie: Movie, raw: unknown): Movie {
  const data = rawGenres.parse(raw);
  const genres = [
    ...new Map(
      data.genres.map(({ id }) => {
        const genre = baseGenres.get(id);
        if (!genre) throw Error(`Unknown TMDB genre ${id}`);
        return [genre.id, genre];
      }),
    ).values(),
  ];
  const legacy = movie.genreProfile?.legacy ?? movie.genres;
  const sourceIds = new Set(legacy.map((g) => g.id));
  const keywords = new Set((data.keywords?.keywords ?? []).map((k) => k.name.toLowerCase().trim()));
  const previous = new Set(movie.subgenres?.map((g) => g.id));
  const subgenres: Entity[] = subgenreDefinitions
    .filter(
      ([id, , , sources, words]) =>
        (!data.keywords && previous.has(`subgenre:${id}`)) ||
        sources.some((s) => sourceIds.has(s)) ||
        words.some((w) => keywords.has(w)),
    )
    .map(([id, en, ru]) => ({ id: `subgenre:${id}`, name: en, names: { en, ru } }));
  return { ...movie, genres, subgenres, genreProfile: { version: 1, legacy } };
}

export function genreIn(movie: Movie, ids: string[]) {
  return [...movie.genres, ...(movie.subgenres ?? [])].some(
    (g) =>
      ids.includes(g.id) ||
      subgenreDefinitions.some(
        ([id, , , sources]) =>
          g.id === `subgenre:${id}` && sources.some((source) => ids.includes(source)),
      ),
  );
}
