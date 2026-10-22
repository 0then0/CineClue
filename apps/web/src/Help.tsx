import { useEffect, useRef } from "react";
import { useBackdropClose } from "./dialog.ts";
import type { Messages } from "./i18n.ts";

export function HelpDialog({ t, onClose }: { t: Messages; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="stats-dialog help-dialog"
      aria-labelledby="help-dialog-title"
      onClose={onClose}
      {...backdropClose}
    >
      <div className="dialog-heading">
        <h2 id="help-dialog-title">{t.help}</h2>
        <button type="button" aria-label={t.closeDialog} onClick={() => ref.current?.close()}>
          ×
        </button>
      </div>
      <p>{t.helpText}</p>
      <section>
        <h3>{t.helpColors}</h3>
        <ul className="help-color-guide">
          <li>
            <span className="help-swatch exact" aria-hidden="true" />
            {t.helpExact}
          </li>
          <li>
            <span className="help-swatch close" aria-hidden="true" />
            {t.helpPartial}
          </li>
          <li>
            <span className="help-swatch miss" aria-hidden="true" />
            {t.helpMiss}
          </li>
        </ul>
      </section>
      <section>
        <h3>{t.helpArrows}</h3>
        <p>{t.helpNumbers}</p>
      </section>
      <section>
        <h3>{t.hints}</h3>
        <p>{t.hintsLockedText}</p>
        <p>{t.hintsIntro}</p>
      </section>
      <section>
        <h3>{t.helpAttributes}</h3>
        <p>{t.helpSets}</p>
      </section>
      <section>
        <h3>{t.helpModes}</h3>
        <p>{t.helpDaily}</p>
      </section>
    </dialog>
  );
}
