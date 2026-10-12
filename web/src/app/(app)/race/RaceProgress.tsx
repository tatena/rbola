"use client";

import { useEffect, useState } from "react";

const LABELS = ["TRACK", "TIER", "CAR"];
const KEY = "rbola.race.prog";

// shared race-flow progress strip — the gold fill animates from the previous
// step's width on mount (stored in sessionStorage), so navigating between
// steps slides the bar instead of snapping it
export default function RaceProgress({ step }: { step: number }) {
  const target = ((step + 1) / 3) * 100;
  const [w, setW] = useState(() => {
    if (typeof window === "undefined") return target;
    const prev = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(prev) && prev > 0 ? prev : target;
  });

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setW(target);
        sessionStorage.setItem(KEY, String(target));
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [target]);

  return (
    <div className="flex flex-col gap-2 px-5 pt-4">
      <span className="flex justify-between">
        {LABELS.map((label, n) => (
          <span
            key={label}
            className="font-mono text-[7.5px] font-medium tracking-[.24em] transition-colors duration-500"
            style={{
              color:
                n === step
                  ? "#C9B37E"
                  : n < step
                    ? "rgba(201,179,126,.55)"
                    : "rgba(242,241,238,.3)",
            }}
          >
            {label}
          </span>
        ))}
      </span>
      <span className="relative block h-[2px] overflow-hidden rounded-[1px] bg-[rgba(233,231,226,.12)]">
        <span
          suppressHydrationWarning
          className="absolute bottom-0 left-0 top-0 rounded-[1px] bg-accent"
          style={{
            width: `${w}%`,
            transition: "width .6s cubic-bezier(.2,.8,.2,1)",
          }}
        />
      </span>
    </div>
  );
}
