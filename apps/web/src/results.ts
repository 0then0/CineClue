import type { GameView } from "../../../packages/game-engine/src/model.ts";
export const clueKeys = [
  "year",
  "directors",
  "genres",
  "actors",
  "runtime",
  "countries",
  "studios",
] as const;
export function shareText(game: GameView) {
  const label =
    game.mode === "daily"
      ? `Daily ${game.date}`
      : game.mode === "challenge"
        ? "Challenge"
        : "Unlimited";
  const grid = game.guesses
    .map((g) =>
      clueKeys
        .map(
          (k) => ({ exact: "🟩", partial: "🟨", close: "🟨", miss: "🟥" })[g.comparison[k].status],
        )
        .join(""),
    )
    .join("\n");
  return `CineClue · ${label}\n\n${grid}\n\n${game.status === "won" ? game.guesses.length : "X"}/${game.maxAttempts}`;
}
export type DailyRecord = { date: string; won: boolean; attempts: number };
export function stats(records: DailyRecord[], today = new Date().toISOString().slice(0, 10)) {
  const sorted = [...new Map(records.map((r) => [r.date, r])).values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  let best = 0,
    run = 0,
    previous = "";
  const distribution = Array<number>(8).fill(0);
  for (const r of sorted) {
    const contiguous = Date.parse(r.date) - Date.parse(previous) === 86400000;
    run = r.won ? (contiguous ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    previous = r.date;
    if (r.won && r.attempts >= 1 && r.attempts <= 8) distribution[r.attempts - 1]++;
  }
  const latest = sorted.at(-1);
  const age = latest ? (Date.parse(today) - Date.parse(latest.date)) / 86400000 : Infinity;
  const wins = sorted.filter((r) => r.won).length;
  return {
    played: sorted.length,
    wins,
    winRate: sorted.length ? Math.round((wins / sorted.length) * 100) : 0,
    streak: age <= 1 ? run : 0,
    best,
    distribution,
  };
}
