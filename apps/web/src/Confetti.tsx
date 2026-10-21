import { type CSSProperties, useEffect, useState } from "react";

export function Confetti() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setActive(false), 4200);
    return () => clearTimeout(timer);
  }, []);
  if (!active) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 48 }, (_, i) => (
        <i
          key={`confetti-${i}`}
          style={
            {
              "--x": `${(i * 37) % 100}%`,
              "--drift": `${((i * 29) % 160) - 80}px`,
              "--delay": `${(i % 8) * 0.08}s`,
              "--spin": `${i % 2 ? 540 : -540}deg`,
              "--color": ["#76b9ed", "#79c99e", "#e9bd60", "#c8a4de"][i % 4],
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
