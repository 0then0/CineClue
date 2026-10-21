import { z } from "zod";
export const entitySchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1),
  names: z.record(z.string(), z.string()).default({}),
});
export const movieSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1),
  originalTitle: z.string().min(1),
  titles: z.record(z.string(), z.string()).default({}),
  aliases: z.array(z.string()).default([]),
  releaseYear: z.number().int().min(1880).max(2100),
  runtime: z.number().int().min(1).max(1500),
  countries: z.array(entitySchema).min(1),
  genres: z.array(entitySchema).min(1),
  directors: z.array(entitySchema).min(1),
  actors: z.array(entitySchema).min(1).max(8),
  studios: z.array(entitySchema).min(1),
  externalIds: z.record(z.string(), z.string()),
  popularityScore: z.number().min(0).max(100),
  provenance: z
    .array(
      z.object({
        provider: z.string(),
        url: z.url(),
        license: z.string(),
        retrievedAt: z.iso.date(),
      }),
    )
    .min(1),
});
export type Entity = z.infer<typeof entitySchema>;
export type Movie = z.infer<typeof movieSchema>;
export type Difficulty = "easy" | "normal" | "hard";
export type Mode = "daily" | "unlimited" | "challenge";
export type Status = "exact" | "close" | "partial" | "miss";
export type NumericResult = { status: Status; value: number; direction: "higher" | "lower" | null };
export type SetResult = { status: Status; values: Entity[]; matches: Entity[] };
export type Comparison = {
  year: NumericResult;
  runtime: NumericResult;
  directors: SetResult;
  genres: SetResult;
  actors: SetResult;
  countries: SetResult;
  studios: SetResult;
};
export type PublicMovie = Pick<Movie, "id" | "title" | "titles" | "originalTitle" | "releaseYear">;
export type GuessView = { movie: PublicMovie; comparison: Comparison };
export type GameView = {
  id: string;
  mode: Mode;
  date: string | null;
  maxAttempts: number;
  status: "playing" | "won" | "lost";
  guesses: GuessView[];
  answer?: Movie;
  nextPuzzleAt?: string;
  difficulty: Difficulty;
  hints: HintState;
};
export const publicMovie = (m: Movie): PublicMovie => ({
  id: m.id,
  title: m.title,
  titles: m.titles,
  originalTitle: m.originalTitle,
  releaseYear: m.releaseYear,
});

export const hintKinds = ["genres", "actor", "decade", "filmography"] as const;
export type HintKind = (typeof hintKinds)[number];
export type GameHint =
  | { kind: "genres" | "actor"; values: Entity[] }
  | { kind: "decade"; decade: number }
  | { kind: "filmography"; movies: PublicMovie[] };
export type HintState = {
  unlocked: number;
  remaining: number;
  nextUnlock: 3 | 7 | null;
  options: HintKind[];
  used: GameHint[];
};

export const mediaImageSchema = z.object({
  url: z.url(),
  source: z.url(),
  author: z.string(),
  license: z.string(),
  licenseUrl: z.url(),
  provider: z.enum(["commons", "tmdb"]),
});
export const movieMediaSchema = z.object({
  poster: mediaImageSchema.optional(),
  people: z.record(z.string(), mediaImageSchema),
  countries: z.record(z.string(), z.string().regex(/^[A-Z]{2}$/)),
});
export type MediaImage = z.infer<typeof mediaImageSchema>;
export type MovieMedia = z.infer<typeof movieMediaSchema>;
