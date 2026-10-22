import { useEffect, useState } from "react";
import { historicalCountryCodes } from "../../../packages/game-engine/src/countries.ts";
import type { MediaImage, MovieMedia } from "../../../packages/game-engine/src/model.ts";
import type { Messages } from "./i18n.ts";
import { cachedMovieMedia, loadMovieMedia } from "./media-cache.ts";

export function useMovieMedia(id: string) {
  const [state, setState] = useState(() => ({ id, media: cachedMovieMedia(id) }));
  useEffect(() => {
    let active = true;
    loadMovieMedia(id)
      .then((media) => {
        if (active) setState({ id, media });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return (state.id === id ? state.media : cachedMovieMedia(id)) ?? { people: {}, countries: {} };
}
export function MediaPicture({
  image,
  name,
  poster = false,
}: {
  image?: MediaImage;
  name: string;
  poster?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`media-picture ${poster ? "movie-poster" : "person-photo"}`}
      aria-hidden="true"
    >
      <span>
        {poster
          ? "▧"
          : name
              .split(/\s+/)
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
      </span>
      {image && !failed && (
        <img
          key={image.url}
          src={image.url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
export function StudioLogo({ image }: { image?: MediaImage }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return null;
  return (
    <span className="studio-logo" aria-hidden="true">
      <img
        key={image.url}
        src={image.url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function flag(iso?: string) {
  return iso && /^[A-Z]{2}$/.test(iso) && !historicalCountryCodes.has(iso)
    ? String.fromCodePoint(...[...iso].map((c) => 127397 + c.charCodeAt(0)))
    : "🌐";
}
export function MediaCredits({ media, t }: { media: MovieMedia; t: Messages }) {
  const images = [
    ...new Map(
      [media.poster, ...Object.values(media.people), ...Object.values(media.studios ?? {})]
        .filter((v): v is MediaImage => !!v)
        .map((image) => [image.source, image]),
    ).values(),
  ];
  if (!images.length) return null;
  const tmdb = images.some((image) => image.provider === "tmdb");
  return (
    <details className="media-credits">
      <summary>{t.imageCredits}</summary>
      <p className="media-crop-note">{t.imageCrop}</p>
      <ul>
        {images
          .filter((image) => image.provider === "commons")
          .map((image) => (
            <li key={image.source}>
              <a href={image.source} target="_blank" rel="noreferrer">
                {image.author}
              </a>{" "}
              ·{" "}
              <a href={image.licenseUrl} target="_blank" rel="noreferrer">
                {image.license}
              </a>{" "}
              · Wikimedia Commons
            </li>
          ))}
      </ul>
      {tmdb && (
        <div className="tmdb-credit">
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            <img src="/tmdb.svg" alt="TMDB" width="72" height="10" />
          </a>
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        </div>
      )}
    </details>
  );
}
