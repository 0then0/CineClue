import { useEffect, useRef, useState } from "react";
import type { GameHint, GameView, HintKind } from "../../../packages/game-engine/src/model.ts";
import { entityName } from "./catalog-i18n.ts";
import { HttpError, readStorage, writeStorage } from "./client.ts";
import { type Locale, type Messages, titleOf } from "./i18n.ts";

const labels = {
  genres: "hintGenres",
  actor: "hintActor",
  decade: "hintDecade",
  filmography: "hintFilmography",
} as const satisfies Record<HintKind, keyof Messages>;
const hintKinds = Object.keys(labels) as HintKind[];
const descriptions = {
  genres: "hintGenresDescription",
  actor: "hintActorDescription",
  decade: "hintDecadeDescription",
  filmography: "hintFilmographyDescription",
} as const;
function HintContent({ hint, locale }: { hint: GameHint; locale: Locale }) {
  if ("values" in hint)
    return <span>{hint.values.map((e) => entityName(e, locale)).join(" · ")}</span>;
  if (hint.kind === "decade")
    return (
      <span>
        {hint.decade}–{hint.decade + 9}
      </span>
    );
  return (
    <span>{hint.movies.map((m) => `${titleOf(m, locale)} (${m.releaseYear})`).join(" · ")}</span>
  );
}
function HintDialog({
  game,
  t,
  pending,
  onUse,
  onClose,
}: {
  game: GameView;
  t: Messages;
  pending: boolean;
  onUse: (kind: HintKind) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function choose(kind: HintKind) {
    setError("");
    try {
      await onUse(kind);
      ref.current?.close();
    } catch (e) {
      setError(e instanceof HttpError && e.code in t ? t[e.code as keyof Messages] : t.error);
    }
  }
  return (
    <dialog
      ref={ref}
      className="stats-dialog hint-dialog"
      aria-labelledby="hint-dialog-title"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id="hint-dialog-title">{t.chooseHint}</h2>
        <button type="button" aria-label={t.closeDialog} onClick={() => ref.current?.close()}>
          ×
        </button>
      </div>
      <p className="hint-intro">{t.hintsIntro}</p>
      <p className="hint-budget">
        {t.hintsRemaining}: <strong>{game.hints.remaining}</strong>
      </p>
      <div className="hint-choices">
        {hintKinds.map((kind) => {
          const used = game.hints.used.some((h) => h.kind === kind);
          const available = game.hints.options.includes(kind);
          return (
            <button
              type="button"
              key={kind}
              disabled={pending || used || !available || game.hints.remaining === 0}
              onClick={() => void choose(kind)}
            >
              <strong>{t[labels[kind]]}</strong>
              <span>
                {used ? t.hintUsed : !available ? t.hintUnavailable : t[descriptions[kind]]}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="hint-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="hint-continue" onClick={() => ref.current?.close()}>
        {t.keepGuessing}
      </button>
    </dialog>
  );
}
export function Hints({
  game,
  locale,
  t,
  pending,
  onUse,
}: {
  game: GameView;
  locale: Locale;
  t: Messages;
  pending: boolean;
  onUse: (kind: HintKind) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (game.status !== "playing" || game.hints.remaining === 0) return;
    const key = `cineclue:hint-offer:${game.id}`;
    const value = readStorage<unknown>(key, 0);
    const seen = typeof value === "number" ? value : 0;
    if (game.hints.unlocked > seen) {
      writeStorage(key, game.hints.unlocked);
      setOpen(true);
    }
  }, [game.id, game.status, game.hints.unlocked, game.hints.remaining]);
  return (
    <section className="hints" aria-label={t.hints}>
      {game.status === "playing" && (
        <div className="hint-toolbar">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={pending || game.hints.remaining === 0}
          >
            {t.hints}{" "}
            <span>
              {t.hintsUsed}: {game.hints.used.length} / 2
            </span>
          </button>
          <p>
            {game.hints.unlocked === 0
              ? t.hintsLockedText
              : game.hints.nextUnlock
                ? `${t.hintsNext} ${game.hints.nextUnlock} ${t.misses}`
                : `${t.hintsRemaining}: ${game.hints.remaining}`}
          </p>
        </div>
      )}
      {game.hints.used.length > 0 && (
        <div className="revealed-hints" aria-live="polite">
          {game.hints.used.map((hint) => (
            <div key={hint.kind}>
              <strong>{t[labels[hint.kind]]}</strong>
              <HintContent hint={hint} locale={locale} />
            </div>
          ))}
        </div>
      )}
      {open && game.status === "playing" && (
        <HintDialog
          game={game}
          t={t}
          pending={pending}
          onUse={onUse}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
