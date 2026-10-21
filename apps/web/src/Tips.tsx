import { useEffect, useState } from "react";
import type { Messages } from "./i18n.ts";

const tips = [
  ["tipArrowsTitle", "tipArrowsBody"],
  ["tipMatchesTitle", "tipMatchesBody"],
  ["tipCloseTitle", "tipCloseBody"],
  ["tipSearchTitle", "tipSearchBody"],
  ["tipStrategyTitle", "tipStrategyBody"],
  ["tipHintsTitle", "tipHintsBody"],
] as const;
export const TIP_INTERVAL_MS = 8000;
export function Tips({ t }: { t: Messages }) {
  const [{ index, elapsed }, setSlide] = useState({ index: 0, elapsed: 0 });
  const [paused, setPaused] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const listener = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || hidden) return;
    let previous = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - previous;
      previous = now;
      setSlide((slide) => {
        const total = slide.elapsed + delta;
        return {
          index: (slide.index + Math.floor(total / TIP_INTERVAL_MS)) % tips.length,
          elapsed: total % TIP_INTERVAL_MS,
        };
      });
    }, 50);
    return () => clearInterval(timer);
  }, [paused, hovered, focused, hidden]);
  function change(delta: number) {
    setSlide((slide) => ({ index: (slide.index + delta + tips.length) % tips.length, elapsed: 0 }));
  }
  const [heading, body] = tips[index];
  return (
    <section
      className="tips"
      aria-label={t.tipLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div className="tip-progress" aria-hidden="true">
        {tips.map(([id], i) => (
          <span className={i === index ? "active" : i < index ? "complete" : ""} key={id}>
            <span
              style={{
                transform: `scaleX(${i < index ? 1 : i === index ? elapsed / TIP_INTERVAL_MS : 0})`,
              }}
            />
          </span>
        ))}
      </div>
      <div className="tip-heading">
        <div>
          <p className="eyebrow">{t.tipLabel}</p>
          <h2 className="tip-transition" key={heading}>
            {t[heading]}
          </h2>
        </div>
        <div className="tip-controls">
          <button type="button" aria-label={t.previousTip} onClick={() => change(-1)}>
            ‹
          </button>
          <button
            type="button"
            aria-label={paused ? t.playTips : t.pauseTips}
            onClick={() => {
              if (paused) {
                setFocused(false);
                setHovered(false);
              }
              setPaused((p) => !p);
            }}
          >
            {paused ? "▶" : "Ⅱ"}
          </button>
          <button type="button" aria-label={t.nextTip} onClick={() => change(1)}>
            ›
          </button>
        </div>
      </div>
      <p className="tip-body tip-transition" key={body}>
        {t[body]}
      </p>
    </section>
  );
}
