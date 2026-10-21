import { useEffect, useId, useRef, useState } from "react";
import type { PublicMovie } from "../../../packages/game-engine/src/model.ts";
import { api } from "./client.ts";
import { type Locale, type Messages, titleOf } from "./i18n.ts";
export function Search({
  locale,
  t,
  onSelect,
  disabled,
  excluded = [],
}: {
  locale: Locale;
  t: Messages;
  onSelect: (m: PublicMovie) => Promise<void>;
  disabled?: boolean;
  excluded?: string[];
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PublicMovie[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const excludeKey = excluded.join(",");
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setActive(-1);
    setError(false);
    if (query.trim().length < 2) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api<{ movies: PublicMovie[] }>(
        `/movies/search?q=${encodeURIComponent(query)}`,
        undefined,
        controller.signal,
      )
        .then((b) => {
          if (!controller.signal.aborted) {
            setItems(b.movies.filter((m) => !excludeKey.split(",").includes(m.id)));
            setLoading(false);
          }
        })
        .catch((e) => {
          if (e.name !== "AbortError" && !controller.signal.aborted) {
            setError(true);
            setLoading(false);
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, excludeKey]);
  async function choose(m: PublicMovie) {
    setOpen(false);
    try {
      await onSelect(m);
      setQuery("");
      input.current?.focus();
    } catch {
      setOpen(true);
    }
  }
  return (
    <div className="search-block">
      <label htmlFor={`${listId}-input`}>{t.search}</label>
      <div className="search-field">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        <input
          id={`${listId}-input`}
          ref={input}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open && query.trim().length >= 2}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={`${listId}-hint`}
          placeholder={t.placeholder}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setActive(-1);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => (items.length ? (i + 1) % items.length : -1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
            }
            if (e.key === "Enter" && open && active >= 0 && items[active]) {
              e.preventDefault();
              void choose(items[active]);
            }
          }}
        />
        <kbd>↵</kbd>
      </div>
      <small id={`${listId}-hint`}>{t.searchHint}</small>
      {open && query.trim().length >= 2 && (
        <div className="suggestions">
          <div id={listId} role="listbox" aria-label={t.search}>
            {items.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="option"
                tabIndex={-1}
                id={`${listId}-${i}`}
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(m)}
              >
                <span>
                  {titleOf(m, locale)}
                  <small>{m.originalTitle !== titleOf(m, locale) ? m.originalTitle : ""}</small>
                </span>
                <span className="search-year">{m.releaseYear} ↗</span>
              </button>
            ))}
          </div>
          {(loading || error || !items.length) && (
            <p role="status">{loading ? t.searching : error ? t.error : t.noResults}</p>
          )}
        </div>
      )}
    </div>
  );
}
