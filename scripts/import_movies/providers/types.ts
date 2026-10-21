import type { Movie } from "../../../packages/game-engine/src/index.ts";
export interface MovieProvider {
  readonly name: string;
  load(): Promise<unknown[]>;
  normalize(raw: unknown[]): Promise<Movie[]>;
}
