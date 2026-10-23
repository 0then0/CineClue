import type { Movie } from "../../../packages/game-engine/src/model.ts";
import { countryName, entityName } from "./catalog-i18n.ts";
import { countryCode } from "./countries.ts";
import { type Locale, type Messages, titleOf } from "./i18n.ts";
import { flag, MediaCredits, MediaPicture, StudioLogo, useMovieMedia } from "./Media.tsx";

export function Answer({ movie, locale, t }: { movie: Movie; locale: Locale; t: Messages }) {
  const media = useMovieMedia(movie.id);
  return (
    <div className="answer-details">
      <div className="answer-overview">
        <MediaPicture
          key={media.poster?.url ?? movie.id}
          image={media.poster}
          name={titleOf(movie, locale)}
          poster
        />
        <div>
          <strong>{titleOf(movie, locale)}</strong>
          <p>
            {movie.originalTitle} · {movie.releaseYear} · {movie.runtime} {t.min}
          </p>
          <p>
            <b>{t.genres}:</b> {movie.genres.map((e) => entityName(e, locale)).join(", ")}
          </p>
          {!!movie.subgenres?.length && (
            <p>
              <b>{t.subgenres}:</b> {movie.subgenres.map((e) => entityName(e, locale)).join(", ")}
            </p>
          )}
          <p className="answer-countries">
            <b>{t.countries}:</b>{" "}
            {movie.countries.map((e) => (
              <span key={e.id}>
                <span aria-hidden="true">{flag(countryCode(e.id, media.countries[e.id]))}</span>{" "}
                {countryName(e, locale)}
              </span>
            ))}
          </p>
          <div className="answer-studios">
            <b>{t.studios}:</b>
            {movie.studios.map((e) => (
              <span className="studio-token" key={e.id}>
                <StudioLogo
                  key={media.studios?.[e.id]?.url ?? e.id}
                  image={media.studios?.[e.id]}
                />
                <span>{entityName(e, locale)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="answer-people">
        {(["directors", "actors"] as const).map((kind) => (
          <section key={kind}>
            <h3>{t[kind]}</h3>
            <div className="answer-portraits">
              {movie[kind].map((person) => {
                const name = entityName(person, locale);
                return (
                  <div className="answer-person" key={person.id}>
                    <MediaPicture
                      key={media.people[person.id]?.url ?? person.id}
                      image={media.people[person.id]}
                      name={name}
                    />
                    <span>{name}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <MediaCredits media={media} t={t} />
    </div>
  );
}
