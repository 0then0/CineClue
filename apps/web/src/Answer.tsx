import type { Movie } from "../../../packages/game-engine/src/model.ts";
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
            <b>{t.genres}:</b> {movie.genres.map((e) => e.names[locale] ?? e.name).join(", ")}
          </p>
          <p className="answer-countries">
            <b>{t.countries}:</b>{" "}
            {movie.countries.map((e) => (
              <span key={e.id}>
                <span aria-hidden="true">{flag(media.countries[e.id])}</span>{" "}
                {e.names[locale] ?? e.name}
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
                <span>{e.names[locale] ?? e.name}</span>
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
                const name = person.names[locale] ?? person.name;
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
