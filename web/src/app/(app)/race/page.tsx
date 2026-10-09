"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOwner } from "@/lib/useOwner";
import RaceProgress from "./RaceProgress";

// Race flow step 1 — SELECT TRACK (design: Claude Design "RBOLA Phone.dc.html"
// race step 0 / "RBOLA Track Select v1"). Accordion of three track panels, all
// visible; the open one grows and shows the terrain weight gauges.
// Logic per tasks/race-logic.md: weights are the LOCKED v0 terrain table
// (frozen per race at entry time), not the demo's eyeballed numbers.

type Track = {
  key: string;
  name: string;
  // [SPD, ACC, HDL] percentages — tasks/race-logic.md terrain table v0
  w: [number, number, number];
  video?: string;
  img?: string;
  grade: string;
};

// track art: founder's uploads (2026-10-08), originals in
// card-assets/track-art-originals/. Art is already graded dark — keep
// filters light-touch; inactive dimming does the state work.
const TRACKS: Track[] = [
  {
    key: "HIGHWAY RUN",
    name: "HIGHWAY RUN",
    w: [50, 30, 20],
    img: "/tracks/highway.jpg",
    grade: "saturate(.85)",
  },
  {
    key: "DRAG STRIP",
    name: "DRAG STRIP",
    w: [30, 60, 10],
    img: "/tracks/drag.jpg",
    grade: "saturate(.9) contrast(1.05)",
  },
  {
    key: "MOUNTAIN PASS",
    name: "MOUNTAIN PASS",
    w: [20, 30, 50],
    img: "/tracks/mountain.jpg",
    grade: "saturate(.9) contrast(1.05)",
  },
];

const GAUGE_KEYS = ["SPD", "ACC", "HDL"] as const;

// per-letter rise cascade on the active track name (design: rbola-rise,
// .15s base + .04s/letter)
function Cascade({
  text,
  animKey,
}: {
  text: string;
  animKey: string | number;
}) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span
          key={`${animKey}-${i}`}
          className="rbola-rise inline-block whitespace-pre"
          style={{ animationDelay: `${0.15 + i * 0.04}s` }}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

export default function RaceTrackSelect() {
  const router = useRouter();
  const [sel, setSel] = useState(2); // MOUNTAIN PASS open by default (design)
  const [sol, setSol] = useState<number | null>(null);

  const { owner, pending } = useOwner();
  useEffect(() => {
    if (pending) return;
    fetch(`/api/garage${owner ? `?owner=${owner}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.error) setSol(j.sol ?? null);
      })
      .catch(() => {});
  }, [owner, pending]);

  const onContinue = () => {
    sessionStorage.setItem("rbola.race.track", TRACKS[sel].key);
    router.push("/race/tier");
  };

  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{
        background: "linear-gradient(180deg,#0A0A0F,#101015)",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)",
      }}
    >
      {/* header — back · RACE/SELECT TRACK · SOL chip */}
      <div className="relative flex items-center justify-between px-5 pt-[6px]">
        <button
          onClick={() => router.push("/garage")}
          className="flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{ border: ".5px solid rgba(233,231,226,.16)" }}
          aria-label="Back"
        >
          <span
            className="ml-[3px] block h-[9px] w-[9px] rotate-45"
            style={{
              borderLeft: "1px solid rgba(242,241,238,.7)",
              borderBottom: "1px solid rgba(242,241,238,.7)",
            }}
          />
        </button>
        <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-[3px]">
          <span className="pl-[.28em] font-mono text-[12px] font-semibold tracking-[.28em] text-foreground">
            RACE
          </span>
          <span className="pl-[.2em] font-mono text-[8.5px] tracking-[.2em] text-foreground/35">
            SELECT TRACK
          </span>
        </div>
        <div
          className="flex h-7 items-center gap-[6px] rounded-full px-[10px]"
          style={{ border: ".5px solid rgba(233,231,226,.16)" }}
        >
          <span className="h-[5px] w-[5px] rotate-45 rounded-[1px] bg-foreground/55" />
          <span className="font-mono text-[10.5px] font-medium text-foreground">
            {sol === null ? "—" : sol.toFixed(2)}
          </span>
        </div>
      </div>

      <RaceProgress step={0} />

      {/* track panels — accordion, all visible */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-[18px]">
        {TRACKS.map((t, i) => {
          const on = i === sel;
          return (
            <button
              key={t.key}
              onClick={() => setSel(i)}
              className="relative min-h-0 overflow-hidden rounded-[18px] text-left focus-visible:outline-none"
              style={{
                background: "#111117",
                border: `.5px solid ${on ? "rgba(201,179,126,.55)" : "rgba(233,231,226,.08)"}`,
                flex: `${on ? 2.1 : 1} 1 0px`,
                transition:
                  "flex .6s cubic-bezier(.2,.8,.2,1), border-color .4s ease",
                cursor: on ? "default" : "pointer",
              }}
            >
              <span
                className="absolute inset-0 block transition-[filter] duration-500"
                style={{ filter: t.grade + (on ? "" : " brightness(.75)") }}
              >
                {t.video ? (
                  <video
                    src={t.video}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.img}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    style={{ objectPosition: "50% 30%" }}
                  />
                )}
              </span>
              <span
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg,rgba(10,10,15,.1) 0%,rgba(10,10,15,.2) 40%,rgba(10,10,15,.88) 100%)",
                }}
              />
              <span
                className="pointer-events-none absolute inset-0 bg-background transition-opacity duration-500"
                style={{ opacity: on ? 0 : 0.4 }}
              />

              <span className="pointer-events-none absolute bottom-5 left-[22px] right-[22px] flex flex-col gap-[14px]">
                <span
                  className="flex font-mono text-[15px] font-semibold uppercase leading-none tracking-[.3em] transition-colors duration-[400ms]"
                  style={{ color: on ? "#F2F1EE" : "rgba(242,241,238,.55)" }}
                >
                  {on ? (
                    <Cascade text={t.name} animKey={sel} />
                  ) : (
                    <span className="whitespace-pre">{t.name}</span>
                  )}
                </span>

                {on && (
                  <span className="flex gap-[22px]">
                    {GAUGE_KEYS.map((k, j) => {
                      const v = t.w[j];
                      return (
                        <span
                          key={k}
                          className="rbola-rise flex w-[68px] flex-col items-center gap-[6px]"
                          style={{ animationDelay: `${0.55 + j * 0.12}s` }}
                        >
                          <svg
                            viewBox="0 0 56 32"
                            width="68"
                            height="39"
                            className="block overflow-visible"
                          >
                            <path
                              d="M4 30 A24 24 0 0 1 52 30"
                              fill="none"
                              stroke="rgba(242,241,238,.12)"
                              strokeWidth="1.3"
                              strokeLinecap="round"
                            />
                            <path
                              d="M4 30 A24 24 0 0 1 52 30"
                              fill="none"
                              stroke="rgba(201,179,126,.85)"
                              strokeWidth="1.3"
                              strokeLinecap="round"
                              pathLength={1}
                              className="rbola-sweep"
                              style={{
                                strokeDasharray: 1,
                                strokeDashoffset: 1 - v / 100,
                                animationDelay: `${0.75 + j * 0.12}s`,
                              }}
                            />
                            <line
                              x1="28"
                              y1="30"
                              x2="28"
                              y2="10"
                              stroke="rgba(242,241,238,.6)"
                              strokeWidth="1"
                              strokeLinecap="round"
                              className="rbola-needle"
                              style={{
                                transformOrigin: "28px 30px",
                                transform: `rotate(${-90 + v * 1.8}deg)`,
                                animationDelay: `${0.75 + j * 0.12}s`,
                              }}
                            />
                            <circle
                              cx="28"
                              cy="30"
                              r="1.6"
                              fill="rgba(242,241,238,.6)"
                            />
                          </svg>
                          <span className="flex items-baseline gap-[6px]">
                            <span className="font-mono text-[8px] tracking-[.18em] text-foreground/50">
                              {k}
                            </span>
                            <span className="font-mono text-[8px] text-accent/70">
                              {v}%
                            </span>
                          </span>
                        </span>
                      );
                    })}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* CONTINUE */}
      <div className="px-5 pt-4">
        <button
          onClick={onContinue}
          className="flex h-[54px] w-full items-center justify-center rounded-[15px] transition-transform active:scale-[.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{
            background: "#14141A",
            border: "1px solid rgba(201,179,126,.6)",
            boxShadow:
              "0 10px 30px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
          }}
        >
          <span className="pl-[.3em] font-mono text-[12px] font-semibold tracking-[.3em] text-foreground">
            CONTINUE
          </span>
        </button>
      </div>
    </div>
  );
}
