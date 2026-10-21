import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Difficulty,
  GameView,
  HintKind,
  PublicMovie,
} from "../../../packages/game-engine/src/model.ts";
import { Answer } from "./Answer.tsx";
import { Clues } from "./Clues.tsx";
import { Confetti } from "./Confetti.tsx";
import { api, HttpError, readStorage, writeStorage } from "./client.ts";
import { Hints } from "./Hints.tsx";
import { dictionaries, type Locale, type Messages } from "./i18n.ts";
import { readRecords, saveRecord } from "./records.ts";
import { type DailyRecord, shareText, stats } from "./results.ts";
import { Search } from "./Search.tsx";
import { Tips } from "./Tips.tsx";

type Pack = {
  id: string;
  name: Record<string, string>;
  count: number;
  counts?: Record<Difficulty, number>;
  category?: "all" | "genre" | "era" | "director";
  rules?: { yearMin?: number; yearMax?: number };
};
type Theme = "system" | "light" | "dark";
const route = () => window.location.pathname;
function errorMessage(e: unknown, t: Messages) {
  return e instanceof HttpError && e.code in t ? t[e.code as keyof Messages] : t.error;
}
function StatsDialog({
  records,
  t,
  onClose,
}: {
  records: DailyRecord[];
  t: Messages;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const data = stats(records);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="stats-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <h2>{t.stats}</h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label={t.closeDialog}>
          ×
        </button>
      </div>
      <div className="stats-grid">
        {(["played", "wins", "winRate", "streak", "best"] as const).map((k) => (
          <div key={k}>
            <strong>{data[k]}</strong>
            <span>{t[k]}</span>
          </div>
        ))}
      </div>
      <h3>{t.distribution}</h3>
      {data.played === 0 && <p>{t.noStats}</p>}
      <div className="distribution">
        {data.distribution.map((count, index) => (
          <div key={`attempt-${index + 1}`}>
            <span>{index + 1}</span>
            <div
              style={{ width: `${Math.max(4, (count / Math.max(1, ...data.distribution)) * 85)}%` }}
            >
              {count}
            </div>
          </div>
        ))}
      </div>
      <small>{t.statsNote}</small>
    </dialog>
  );
}
export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const l = readStorage<string>(
      "cineclue:locale",
      navigator.language.startsWith("ru") ? "ru" : "en",
    );
    return l === "ru" ? "ru" : "en";
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const v = readStorage<string>("cineclue:theme", "system");
    return v === "dark" || v === "light" ? v : "system";
  });
  const [celebration, setCelebration] = useState<string | null>(null);
  const [path, setPath] = useState(route);
  const [game, setGame] = useState<GameView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [records, setRecords] = useState<DailyRecord[]>(readRecords);
  const [showStats, setShowStats] = useState(false);
  const [builder, setBuilder] = useState(false);
  const [challengeUrl, setChallengeUrl] = useState("");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [tmdbData, setTmdbData] = useState(false);
  const [catalogSize, setCatalogSize] = useState<number | null>(null);
  const [pack, setPack] = useState("popular");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [now, setNow] = useState(Date.now());
  const [fallbackShare, setFallbackShare] = useState("");
  const t = dictionaries[locale];
  const requestId = useRef(0);
  useEffect(() => {
    document.documentElement.lang = locale;
    writeStorage("cineclue:locale", locale);
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage("cineclue:theme", theme);
  }, [theme]);
  useEffect(() => {
    const listener = () => {
      setPath(route());
      setBuilder(false);
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  const navigate = useCallback((url: string) => {
    window.history.pushState({}, "", url);
    setPath(url);
    setBuilder(false);
    setNotice("");
    setFallbackShare("");
  }, []);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setPending(true);
    setError(null);
    setGame(null);
    try {
      const endpoint = path.startsWith("/challenge/")
        ? `/challenges/${path.split("/")[2]}`
        : path.startsWith("/unlimited/")
          ? path
          : "/daily";
      const value = await api<GameView>(endpoint);
      if (id === requestId.current) setGame(value);
    } catch (e) {
      if (id === requestId.current) setError(e);
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ packs: Pack[]; catalogSize: number; dataSources?: string[] }>(
      "/packs",
      undefined,
      controller.signal,
    )
      .then((b) => {
        setPacks(b.packs);
        setCatalogSize(b.catalogSize);
        setTmdbData(b.dataSources?.includes("tmdb") ?? false);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      game?.mode === "daily" &&
      game.nextPuzzleAt &&
      Date.parse(game.nextPuzzleAt) <= now &&
      !pending
    )
      void load();
  }, [game, now, load, pending]);
  useEffect(() => {
    if (game?.mode !== "daily" || game.status === "playing" || !game.date) return;
    const record = { date: game.date, won: game.status === "won", attempts: game.guesses.length };
    let active = true;
    void saveRecord(record).then((result) => {
      if (!active) return;
      setRecords(result.records);
      if (!result.saved) setNotice("localUnavailable");
    });
    return () => {
      active = false;
    };
  }, [game]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "cineclue:records" || event.key === null) setRecords(readRecords());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  async function guess(movie: PublicMovie) {
    if (!game || pending) return;
    setPending(true);
    setError(null);
    const id = requestId.current;
    const endpoint =
      game.mode === "daily"
        ? "/daily/guess"
        : game.mode === "challenge"
          ? `/challenges/${path.split("/")[2]}/guess`
          : `/unlimited/${game.id}/guess`;
    try {
      const value = await api<GameView>(
        endpoint,
        { movieId: movie.id },
        undefined,
        game.mode === "daily" ? game.id : undefined,
      );
      if (id === requestId.current) {
        setGame(value);
        if (value.status === "won" && game.status === "playing") setCelebration(value.id);
      }
    } catch (e) {
      if (id === requestId.current) setError(e);
      throw e;
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }
  async function useHint(kind: HintKind) {
    if (!game || pending) return;
    const id = requestId.current;
    setPending(true);
    try {
      const value = await api<GameView>(`/games/${game.id}/hints`, { kind });
      if (id === requestId.current) setGame(value);
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }
  async function newUnlimited() {
    setPending(true);
    setError(null);
    const id = requestId.current;
    try {
      const value = await api<GameView>("/unlimited", { difficulty, pack });
      if (id === requestId.current) {
        navigate(`/unlimited/${value.id}`);
      }
    } catch (e) {
      if (id === requestId.current) setError(e);
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }
  async function createChallenge(movie: PublicMovie) {
    setPending(true);
    setError(null);
    try {
      const value = await api<{ path: string }>("/challenges", { movieId: movie.id });
      setChallengeUrl(`${window.location.origin}${value.path}`);
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setPending(false);
    }
  }
  async function share() {
    if (!game) return;
    const text = shareText(game);
    try {
      if (navigator.share) {
        try {
          await navigator.share({ text });
          setNotice("shared");
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(text);
      setNotice("shared");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setFallbackShare(text);
      setNotice("shareUnavailable");
    }
  }
  async function copyChallenge() {
    try {
      await navigator.clipboard.writeText(challengeUrl);
      setNotice("copied");
    } catch {
      setNotice("shareUnavailable");
    }
  }
  const seconds = Math.max(
    0,
    Math.floor(((game?.nextPuzzleAt ? Date.parse(game.nextPuzzleAt) : now) - now) / 1000),
  );
  const countdown = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const mode = builder
    ? "challenge"
    : (game?.mode ??
      (path.startsWith("/unlimited/")
        ? "unlimited"
        : path.startsWith("/challenge/")
          ? "challenge"
          : "daily"));
  const date = game?.date
    ? new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${game.date}T00:00:00Z`))
    : "";
  return (
    <>
      <header className="site-header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <img src="/icon.svg" width="38" height="38" alt="" />
          <span>
            CineClue<small>{t.tagline}</small>
          </span>
        </a>
        <div className="utilities">
          <button
            type="button"
            className="utility-button"
            onClick={() => setShowStats(true)}
            aria-label={t.stats}
            title={t.stats}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 3v17a1 1 0 0 0 1 1h17"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <rect x="6" y="13" width="3" height="5" rx="0.8" fill="currentColor" />
              <rect x="11" y="9" width="3" height="9" rx="0.8" fill="currentColor" />
              <rect x="16" y="4" width="3" height="14" rx="0.8" fill="currentColor" />
            </svg>
          </button>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            aria-label={t.system}
            className="theme-select"
          >
            <option value="system">◐ {t.system}</option>
            <option value="light">☀ {t.light}</option>
            <option value="dark">☾ {t.dark}</option>
          </select>
          <button
            type="button"
            className="language-button"
            onClick={() => setLocale((l) => (l === "en" ? "ru" : "en"))}
            aria-label={locale === "en" ? "Переключить на русский" : "Switch to English"}
          >
            {locale === "en" ? "RU" : "EN"}
          </button>
        </div>
      </header>
      <main>
        <nav className="mode-nav" aria-label={locale === "ru" ? "Режим игры" : "Game mode"}>
          <button
            type="button"
            aria-current={mode === "daily" ? "page" : undefined}
            onClick={() => navigate("/")}
            disabled={pending}
          >
            {t.daily}
            <span className="live-dot" />
          </button>
          <button
            type="button"
            aria-current={mode === "unlimited" ? "page" : undefined}
            onClick={() => void newUnlimited()}
            disabled={pending}
          >
            {t.unlimited}
          </button>
          <button
            type="button"
            aria-current={mode === "challenge" ? "page" : undefined}
            onClick={() => {
              setBuilder(true);
              setChallengeUrl("");
              setError(null);
              setNotice("");
            }}
            disabled={pending}
          >
            {t.challenge}
          </button>
        </nav>
        <section className="intro">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{builder ? t.challengeTitle : t.headline}</h1>
          <p>
            {builder
              ? t.challengeIntro
              : mode === "unlimited"
                ? t.practice
                : mode === "challenge"
                  ? t.friend
                  : t.intro}
          </p>
        </section>
        <section className="game-panel" aria-busy={pending}>
          {builder ? (
            <>
              <div className="panel-heading">
                <span>{t.challenge}</span>
                <span>↗</span>
              </div>
              {challengeUrl ? (
                <div className="challenge-ready">
                  <h2>{t.challengeReady}</h2>
                  <label htmlFor="challenge-link">{t.challenge}</label>
                  <input
                    id="challenge-link"
                    readOnly
                    value={challengeUrl}
                    onFocus={(e) => e.target.select()}
                  />
                  <div className="button-row">
                    <button type="button" className="primary" onClick={() => void copyChallenge()}>
                      {t.copy}
                    </button>
                    <button type="button" onClick={() => setChallengeUrl("")}>
                      {t.createAnother}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="search-area">
                  <Search locale={locale} t={t} disabled={pending} onSelect={createChallenge} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="panel-heading">
                <span>
                  <span className="tiny-square" /> {mode === "daily" ? t.today : t[mode]}{" "}
                  {date && <small>{date}</small>}
                </span>
                <span className="attempt-count">
                  {game ? `${game.guesses.length} / ${game.maxAttempts}` : "— / 8"}
                </span>
              </div>
              {mode === "unlimited" && (
                <div className="game-options">
                  <label>
                    {t.difficulty}
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                    >
                      {(["easy", "normal", "hard"] as const).map((d) => (
                        <option key={d} value={d}>
                          {t[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.pack}
                    <select value={pack} onChange={(e) => setPack(e.target.value)}>
                      {packs
                        .filter((p) => p.id === "popular")
                        .map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.name[locale] ?? p.name.en} ({p.counts?.[difficulty] ?? p.count})
                          </option>
                        ))}
                      {(["genre", "era", "director"] as const).map((category) => (
                        <optgroup key={category} label={t[`${category}Collections`]}>
                          {packs
                            .filter(
                              (p) => p.id !== "popular" && (p.category ?? "genre") === category,
                            )
                            .sort((a, b) =>
                              category === "era"
                                ? (a.rules?.yearMin ?? a.rules?.yearMax ?? 0) -
                                  (b.rules?.yearMin ?? b.rules?.yearMax ?? 0)
                                : (a.name[locale] ?? a.name.en).localeCompare(
                                    b.name[locale] ?? b.name.en,
                                    locale,
                                  ),
                            )
                            .map((p) => (
                              <option
                                value={p.id}
                                key={p.id}
                                disabled={(p.counts?.[difficulty] ?? p.count) === 0}
                              >
                                {p.name[locale] ?? p.name.en} ({p.counts?.[difficulty] ?? p.count})
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={pending} onClick={() => void newUnlimited()}>
                    {t.newGame} ↗
                  </button>
                </div>
              )}
              {!game && pending && (
                <p className="loading" role="status">
                  {t.loading}
                </p>
              )}
              {game && (
                <>
                  <div
                    className="attempt-track"
                    role="img"
                    aria-label={`${game.guesses.length} ${t.of} ${game.maxAttempts}`}
                  >
                    {Array.from({ length: 8 }, (_, i) => (
                      <span
                        key={`slot-${i + 1}`}
                        className={
                          i < game.guesses.length
                            ? game.status === "won" && i === game.guesses.length - 1
                              ? "solved"
                              : "used"
                            : ""
                        }
                      />
                    ))}
                  </div>
                  {game.status === "playing" ? (
                    <div className="search-area">
                      <Search
                        locale={locale}
                        t={t}
                        disabled={pending}
                        excluded={game.guesses.map((g) => g.movie.id)}
                        onSelect={guess}
                      />
                    </div>
                  ) : (
                    <section className={`finish ${game.status}`}>
                      {game.status === "won" && celebration === game.id && (
                        <Confetti key={game.id} />
                      )}
                      <p className="eyebrow">
                        {game.status === "won" ? "✓" : "↘"} {game.guesses.length} / 8
                      </p>
                      <h2>{t[game.status]}</h2>
                      <p>{t.answer}</p>
                      {game.answer && (
                        <Answer key={game.answer.id} movie={game.answer} locale={locale} t={t} />
                      )}
                      <div className="button-row">
                        <button type="button" className="primary" onClick={() => void share()}>
                          {t.share} ↗
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void newUnlimited()}
                        >
                          {t.next}
                        </button>
                      </div>
                    </section>
                  )}
                  <Hints
                    key={game.id}
                    game={game}
                    locale={locale}
                    t={t}
                    pending={pending}
                    onUse={useHint}
                  />
                  <div className="legend">
                    <span className="exact">✓ {t.exact}</span>
                    <span className="partial">
                      ≈ {t.partial} / {t.close}
                    </span>
                    <span>× {t.miss}</span>
                  </div>
                  <Clues game={game} locale={locale} t={t} />
                </>
              )}
            </>
          )}
          {error !== null && (
            <div className="error" role="alert">
              <p>{errorMessage(error, t)}</p>
              <button type="button" disabled={pending} onClick={() => void load()}>
                {t.retry}
              </button>
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {t[notice as keyof Messages] ?? notice}
            </p>
          )}
          {fallbackShare && (
            <textarea
              className="share-fallback"
              aria-label={t.share}
              readOnly
              value={fallbackShare}
              onFocus={(e) => e.target.select()}
            />
          )}
        </section>
        <Tips t={t} />
        <div className="below-game">
          <details>
            <summary>
              {t.help}
              <span>+</span>
            </summary>
            <p>{t.helpText}</p>
          </details>
          {game?.mode === "daily" && !builder && (
            <p className="countdown">
              {t.nextDaily} <strong>{countdown}</strong>
              <small>00:00 UTC</small>
            </p>
          )}
        </div>
      </main>
      <footer>
        <span>{t.footer}</span>
        <span>
          {catalogSize !== null && `${catalogSize} ${t.catalog} · `}
          {tmdbData ? t.mixedData : t.openData}
        </span>
        {tmdbData && (
          <div className="tmdb-credit catalog-credit">
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
              <img src="/tmdb.svg" alt="TMDB" width="72" height="10" />
            </a>
            <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          </div>
        )}
      </footer>
      {showStats && <StatsDialog records={records} t={t} onClose={() => setShowStats(false)} />}
    </>
  );
}
