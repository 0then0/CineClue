import { useState } from "react";
import { readStorage, writeStorage } from "./client.ts";
import posters from "./film-posters.json" with { type: "json" };
import type { Locale } from "./i18n.ts";

const cacheKey = "cineclue:poster-shelf:v1";
const ttl = 86400000;

// This pool is a small public snapshot of catalog/media data, never the Daily answer.
export function selectShelf() {
  const cached = readStorage<unknown>(cacheKey, null);
  if (cached && typeof cached === "object" && "expires" in cached && "ids" in cached) {
    const { expires, ids } = cached;
    if (
      typeof expires === "number" &&
      expires > Date.now() &&
      Array.isArray(ids) &&
      ids.length === 3 &&
      new Set(ids).size === 3 &&
      ids.every((id) => typeof id === "string" && posters.some((poster) => poster.id === id))
    ) {
      return ids.flatMap((id) => posters.filter((poster) => poster.id === id));
    }
  }
  const pool = [...posters];
  const selected = Array.from(
    { length: 3 },
    () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0],
  );
  writeStorage(cacheKey, { expires: Date.now() + ttl, ids: selected.map((poster) => poster.id) });
  return selected;
}

export function FilmShelf({ label, locale }: { label: string; locale: Locale }) {
  const [selection] = useState(selectShelf);
  return (
    <div className="film-shelf">
      <div className="shelf-posters">
        {selection.map((poster) => (
          <a
            className="shelf-poster"
            key={poster.id}
            href={poster.source}
            target="_blank"
            rel="noreferrer"
            title={locale === "ru" ? poster.ru : poster.title}
          >
            <img
              src={poster.url}
              alt={locale === "ru" ? poster.ru : poster.title}
              width="185"
              height="278"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </a>
        ))}
      </div>
      <a
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        title={label}
      >
        TMDB <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}
