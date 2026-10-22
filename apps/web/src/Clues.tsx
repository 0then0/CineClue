import { countryName } from "../../../packages/game-engine/src/countries.ts";
import type {
  Entity,
  GameView,
  GuessView,
  MovieMedia,
  NumericResult,
  SetResult,
} from "../../../packages/game-engine/src/model.ts";
import { countryCode } from "./countries.ts";
import { type Locale, type Messages, titleOf } from "./i18n.ts";
import { flag, MediaCredits, MediaPicture, StudioLogo, useMovieMedia } from "./Media.tsx";
import { clueKeys } from "./results.ts";

type ClueKey = (typeof clueKeys)[number];
function EntityValue({
  entity,
  matched,
  kind,
  media,
  locale,
  t,
}: {
  entity: Entity;
  matched: boolean;
  kind: ClueKey;
  media: MovieMedia;
  locale: Locale;
  t: Messages;
}) {
  const name =
    kind === "countries" ? countryName(entity, locale) : (entity.names[locale] ?? entity.name);
  const person = kind === "directors" || kind === "actors";
  return (
    <span
      className={`entity-token ${person ? "person-token" : kind === "studios" ? "studio-token" : ""} ${matched ? "matched" : ""}`}
      title={name}
    >
      {person && (
        <MediaPicture
          key={media.people[entity.id]?.url ?? entity.id}
          image={media.people[entity.id]}
          name={name}
        />
      )}
      {person && (
        <span
          className={`person-verdict ${matched ? "is-match" : "is-miss"}`}
          role="img"
          aria-label={`${name}: ${matched ? t.exact : t.miss}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d={matched ? "m3 8 3 3 7-7" : "m4 4 8 8M12 4l-8 8"}
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      {kind === "countries" && (
        <span className="country-flag" aria-hidden="true">
          {flag(countryCode(entity.id, media.countries[entity.id]))}
        </span>
      )}
      {kind === "studios" && (
        <StudioLogo
          key={media.studios?.[entity.id]?.url ?? entity.id}
          image={media.studios?.[entity.id]}
        />
      )}
      <span className="entity-name">{name}</span>
    </span>
  );
}
function Clue({
  value,
  locale,
  t,
  kind,
  media,
}: {
  value: NumericResult | SetResult;
  locale: Locale;
  t: Messages;
  kind: ClueKey;
  media: MovieMedia;
}) {
  const numeric = "value" in value;
  const mark = value.status === "exact" ? "✓" : value.status === "miss" ? "×" : "≈";
  const people = kind === "actors" || kind === "directors";
  const limit = people && !numeric ? value.values.length : 2;
  const values = numeric
    ? []
    : [...value.values].sort(
        (a, b) =>
          Number(value.matches.some((m) => m.id === b.id)) -
            Number(value.matches.some((m) => m.id === a.id)) ||
          (kind === "genres" ? (a.frequency ?? Infinity) - (b.frequency ?? Infinity) : 0),
      );
  const subgenres =
    !numeric && "subgenres" in value ? (value.subgenres as SetResult | undefined) : undefined;
  const comparable = !numeric && "subgenresComparable" in value && value.subgenresComparable;
  const detailValues =
    subgenres?.values.toSorted(
      (a, b) =>
        Number(subgenres.matches.some((m) => m.id === b.id)) -
          Number(subgenres.matches.some((m) => m.id === a.id)) ||
        (a.frequency ?? Infinity) - (b.frequency ?? Infinity),
    ) ?? [];
  const detailEntity = (e: Entity) => (
    <EntityValue
      key={e.id}
      entity={e}
      matched={!!comparable && !!subgenres?.matches.some((m) => m.id === e.id)}
      kind="genres"
      media={media}
      locale={locale}
      t={t}
    />
  );
  const more = values.length > limit;
  const entity = (e: Entity) => (
    <EntityValue
      key={e.id}
      entity={e}
      matched={!numeric && value.matches.some((m) => m.id === e.id)}
      kind={kind}
      media={media}
      locale={locale}
      t={t}
    />
  );
  return (
    <div className={`clue ${value.status}`} data-kind={kind}>
      <span className={`clue-status ${people ? "people-status" : ""}`} title={t[value.status]}>
        {mark}
        <span className={people ? undefined : "sr-only"}>{t[value.status]}</span>
      </span>
      {numeric ? (
        <strong>
          {value.value}
          {kind === "runtime" ? ` ${t.min}` : ""}{" "}
          {value.direction && (
            <span role="img" aria-label={t[value.direction]} title={t[value.direction]}>
              {value.direction === "higher" ? "↑" : "↓"}
            </span>
          )}
        </strong>
      ) : (
        <>
          <div
            className={`entity-list ${kind === "actors" || kind === "directors" ? "people-list" : ""}`}
          >
            {values.slice(0, limit).map(entity)}
          </div>
          {more && (
            <details className="clue-more">
              <summary aria-label={`${t.showAll}: ${t[kind]}`}>
                {`+${values.length - limit}`}
              </summary>
              <div className="entity-list expanded-entities">{values.slice(limit).map(entity)}</div>
            </details>
          )}
          {detailValues.length > 0 && (
            <section className="genre-subgenres">
              <h4>{t.subgenres}</h4>
              <small>{comparable && subgenres ? t[subgenres.status] : t.noSubgenreData}</small>
              <div className="entity-list">{detailValues.slice(0, 2).map(detailEntity)}</div>
              {detailValues.length > 2 && (
                <details className="clue-more">
                  <summary aria-label={`${t.showAll}: ${t.subgenres}`}>
                    +{detailValues.length - 2}
                  </summary>
                  <div className="entity-list expanded-entities">
                    {detailValues.slice(2).map(detailEntity)}
                  </div>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
function GuessCard({
  guess,
  number,
  locale,
  t,
}: {
  guess: GuessView;
  number: number;
  locale: Locale;
  t: Messages;
}) {
  const media = useMovieMedia(guess.movie.id);
  const title = titleOf(guess.movie, locale);
  return (
    <article className="guess">
      <MediaPicture
        key={media.poster?.url ?? guess.movie.id}
        image={media.poster}
        name={title}
        poster
      />
      <div className="guess-main">
        <div className="guess-heading">
          <span className="guess-number">{String(number).padStart(2, "0")}</span>
          <h2>{title}</h2>
          <span>{guess.movie.releaseYear}</span>
        </div>
        <small className="clue-scroll-hint">{t.scrollClues}</small>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal overflow needs keyboard focus for arrow-key scrolling. */}
        <section className="clue-grid" aria-label={t.filmClues} tabIndex={0}>
          {clueKeys
            .filter((k) => k !== "actors" && k !== "directors")
            .map((k) => (
              <section key={k}>
                <h3>{t[k]}</h3>
                <Clue value={guess.comparison[k]} locale={locale} t={t} kind={k} media={media} />
              </section>
            ))}
        </section>
      </div>
      <div className="guess-people">
        {(["directors", "actors"] as const).map((k) => (
          <section key={k}>
            <h3>{t[k]}</h3>
            <Clue value={guess.comparison[k]} locale={locale} t={t} kind={k} media={media} />
          </section>
        ))}
      </div>
      <MediaCredits media={media} t={t} />
    </article>
  );
}
export function Clues({ game, locale, t }: { game: GameView; locale: Locale; t: Messages }) {
  if (!game.guesses.length)
    return (
      <div className="empty-state">
        <span className="empty-reel" aria-hidden="true">
          ?<i>01</i>
        </span>
        <h2>{t.emptyTitle}</h2>
        <p>{t.emptyText}</p>
        <div role="img" className="empty-clues" aria-label={t.emptyCells}>
          {clueKeys.map((k, i) => (
            <span key={k}>
              {String(i + 1).padStart(2, "0")}
              <br />
              {t[k]}
            </span>
          ))}
        </div>
      </div>
    );
  return (
    <div className="guesses" aria-live="polite">
      {game.guesses.toReversed().map((g, i) => (
        <GuessCard
          key={g.movie.id}
          guess={g}
          number={game.guesses.length - i}
          locale={locale}
          t={t}
        />
      ))}
    </div>
  );
}
