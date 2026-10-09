"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { useRaceWatch, type RaceView } from "@/lib/useRaceEntry";
import "../live.css";

// Race flow after the commit (race-logic.md §5, locked 10-08):
// SEARCHING → match found → VS reveal → race → RESULT.
// Keyed by entry id and driven only by GET /api/race/entry/[id], so a reload
// lands on the right beat. The result is decided server-side before the race
// beat plays — VS + race are pure theatre. Text stays on a hard budget; no
// performance numbers, SOL amounts are the only figures on screen.

const TRACK_ART: Record<string, string> = {
  "MOUNTAIN PASS": "/tracks/mountain.jpg",
  "HIGHWAY RUN": "/tracks/highway.jpg",
  "DRAG STRIP": "/tracks/drag.jpg",
};

const VS_MS = 3400;
const RACE_MS = 4200;
const seenKey = (id: string) => `rbola.race.seen.${id}`;

const sol = (lamports: number) => {
  const s = (lamports / 1e9).toFixed(3);
  return s.endsWith("0") ? s.slice(0, -1) : s;
};

const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

type Act = "vs" | "race" | "result";

// plays VS → race once per entry per tab, then rests on the result; a reload
// after the result skips straight to it (per-tab convenience only)
function useTheatre(id: string, matched: boolean) {
  const [act, setAct] = useState<Act | null>(null);
  useEffect(() => {
    if (!matched) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey(id)) === "1";
    } catch {}
    const at = (ms: number, a: Act) => setTimeout(() => setAct(a), ms);
    const timers = seen
      ? [at(0, "result")]
      : [at(0, "vs"), at(VS_MS, "race"), at(VS_MS + RACE_MS, "result")];
    return () => timers.forEach(clearTimeout);
  }, [id, matched]);
  useEffect(() => {
    if (act !== "result") return;
    try {
      sessionStorage.setItem(seenKey(id), "1");
    } catch {}
  }, [act, id]);
  return act;
}

export default function RaceLive() {
  const { id } = useParams<{ id: string }>();
  const { view, error, cancel, cancelling } = useRaceWatch(id);
  const act = useTheatre(id, view?.status === "matched");

  if (!view) {
    return error ? (
      <Ending headline="Race not found" />
    ) : (
      <div className="min-h-dvh bg-background" />
    );
  }
  if (view.status === "cancelled") return <Left view={view} />;
  if (view.status !== "matched") {
    return <Searching view={view} cancel={cancel} cancelling={cancelling} />;
  }
  // full-bleed beats escape the page-enter transform (which would trap
  // position:fixed) and cover the nav
  if (act === "vs") return createPortal(<Versus view={view} />, document.body);
  if (act === "race") return createPortal(<RaceBeat view={view} />, document.body);
  if (act === "result") return <Result view={view} />;
  return <div className="min-h-dvh bg-background" />;
}

// ---------- SEARCHING ----------

function Searching({
  view,
  cancel,
  cancelling,
}: {
  view: RaceView;
  cancel: () => void;
  cancelling: boolean;
}) {
  const canCancel =
    view.status === "searching" || view.status === "awaiting_payment";
  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{
        background: "#0A0A0F",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)",
      }}
    >
      {/* the ground you chose, waiting */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={TRACK_ART[view.track]}
          alt=""
          className="rl-drift h-full w-full object-cover"
          style={{ filter: "brightness(.32) saturate(.7)" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,rgba(10,10,15,.55) 0%,rgba(10,10,15,.15) 40%,rgba(10,10,15,.92) 100%)",
          }}
        />
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-9 px-8">
        <div
          className="rl-rise relative h-[300px] w-[214px] overflow-hidden rounded-[22px]"
          style={{
            background: "#101016",
            border: ".5px solid rgba(233,231,226,.3)",
            boxShadow:
              "0 26px 60px rgba(0,0,0,.6), inset 0 .5px 0 rgba(255,255,255,.14)",
          }}
        >
          <CarPhoto src={view.car.photo} fallback={TRACK_ART[view.track]} />
          <div
            className="absolute inset-x-0 bottom-0 h-[110px]"
            style={{
              background: "linear-gradient(180deg,rgba(16,16,22,0),#101016)",
            }}
          />
          <span className="absolute inset-x-[14px] bottom-[14px] text-[16px] font-normal leading-[1.2] text-foreground-bright">
            {stripPrefix(view.car.name)}
          </span>
        </div>

        <div
          className="rl-fade flex flex-col items-center gap-[14px]"
          style={{ animationDelay: ".4s" }}
        >
          <span className="rl-breathe pl-[.32em] font-mono text-[10px] tracking-[.32em] text-foreground/70">
            SEARCHING
          </span>
          <span className="relative block h-px w-[120px] overflow-hidden bg-[rgba(233,231,226,.1)]">
            <span className="rl-scan absolute inset-y-0 left-0 block w-[40px] bg-accent/80" />
          </span>
        </div>
      </div>

      <div className="relative flex h-[54px] items-center justify-center">
        {canCancel && (
          <button
            onClick={cancel}
            disabled={cancelling}
            className="px-6 py-3 font-mono text-[9.5px] tracking-[.26em] text-foreground/40 transition-colors hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            {cancelling ? "CANCELLING" : "CANCEL"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- VS — the reveal ----------

function Versus({ view }: { view: RaceView }) {
  const opp = view.opponent!;
  const art = TRACK_ART[view.track];
  return (
    <div className="fixed inset-0 z-30 mx-auto flex w-full max-w-[430px] flex-col overflow-hidden bg-[#07070A]">
      <div className="rl-vs-out flex h-full flex-col">
        {/* rival — hidden until now, drops in from above */}
        <div className="rl-from-top relative min-h-0 flex-1 overflow-hidden">
          <CarPhoto src={opp.photo} fallback={art} unknown={!opp.photo} />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg,rgba(7,7,10,.35) 0%,rgba(7,7,10,0) 35%,rgba(7,7,10,.85) 100%)",
            }}
          />
          <div
            className="rl-rise absolute inset-x-6 bottom-6 flex flex-col gap-[9px]"
            style={{ animationDelay: "1.1s" }}
          >
            <span className="font-mono text-[9px] tracking-[.24em] text-foreground/45">
              {opp.driver}
              {opp.rarity ? ` · ${opp.rarity.toUpperCase()}` : ""}
            </span>
            <span className="text-[24px] font-light leading-[1.15] text-foreground-bright">
              {stripPrefix(opp.name)}
            </span>
          </div>
        </div>

        {/* seam */}
        <div className="relative flex h-[46px] flex-none items-center justify-center">
          <span
            className="rl-seam absolute inset-x-6 top-1/2 block h-[.5px] bg-accent/60"
            style={{ animationDelay: ".75s" }}
          />
          <span
            className="rl-fade relative bg-[#07070A] px-4 pl-[calc(1rem+.3em)] font-mono text-[11px] tracking-[.3em] text-accent"
            style={{ animationDelay: "1s" }}
          >
            VS
          </span>
        </div>

        {/* you — rises from below */}
        <div className="rl-from-bottom relative min-h-0 flex-1 overflow-hidden">
          <CarPhoto src={view.car.photo} fallback={art} />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(0deg,rgba(7,7,10,.35) 0%,rgba(7,7,10,0) 35%,rgba(7,7,10,.85) 100%)",
            }}
          />
          <span
            className="rl-rise absolute inset-x-6 top-6 text-[24px] font-light leading-[1.15] text-foreground-bright"
            style={{ animationDelay: "1.25s" }}
          >
            {stripPrefix(view.car.name)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- RACE — a short cinematic beat on the chosen ground ----------

function RaceBeat({ view }: { view: RaceView }) {
  return (
    <div className="fixed inset-0 z-30 mx-auto w-full max-w-[430px] overflow-hidden bg-[#07070A]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={TRACK_ART[view.track]}
        alt=""
        className="rl-push absolute inset-0 h-full w-full object-cover"
        style={{ filter: "saturate(.9)", transformOrigin: "50% 55%" }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 55%,rgba(7,7,10,0) 30%,rgba(7,7,10,.75) 100%)",
        }}
      />
      <span
        className="rl-rise absolute inset-x-0 top-[22%] text-center font-mono text-[13px] tracking-[.34em] text-foreground"
        style={{ paddingLeft: ".34em", animationDelay: ".2s" }}
      >
        {view.track}
      </span>
      <span
        className="absolute bottom-[max(env(safe-area-inset-bottom),28px)] left-6 right-6 block h-[.5px] bg-[rgba(233,231,226,.14)]"
        aria-hidden
      >
        <span
          className="rl-distance absolute inset-0 block origin-left bg-accent"
          aria-hidden
        />
      </span>
      <div className="rl-blackout absolute inset-0 bg-[#0A0A0F] opacity-0" />
    </div>
  );
}

// ---------- RESULT ----------

function Result({ view }: { view: RaceView }) {
  const outcome = view.result!.outcome;
  const practice = view.room === "practice";
  const p = view.payout;
  const art = TRACK_ART[view.track];
  // the backdrop is whoever took the line (tie: your car)
  const hero =
    outcome === "loss" ? (view.opponent?.photo ?? null) : view.car.photo;
  const headline =
    outcome === "win" ? "You won" : outcome === "tie" ? "Dead heat" : "Outpaced";

  let money: React.ReactNode = null;
  if (!practice) {
    if (outcome === "win" && p) {
      money = <Odometer text={`+${sol(p.lamports)}`} unit="SOL" gold />;
    } else if (outcome === "tie" && p) {
      money = <Odometer text={sol(p.lamports)} unit="SOL REFUNDED" />;
    } else if (outcome === "loss") {
      money = <Odometer text={`−${sol(view.fee)}`} unit="SOL" muted />;
    }
  }

  return (
    <Ending
      headline={headline}
      hero={hero}
      art={art}
      money={money}
      link={!practice && p ? p : null}
    />
  );
}

function Left({ view }: { view: RaceView }) {
  const p = view.payout;
  return (
    <Ending
      headline="Left the queue"
      art={TRACK_ART[view.track]}
      money={
        p && view.fee > 0 ? (
          <Odometer text={sol(p.lamports)} unit="SOL REFUNDED" />
        ) : null
      }
      link={p}
    />
  );
}

// the shared resting frame: image up top, one headline, one money line,
// a quiet receipt link, RACE AGAIN
function Ending({
  headline,
  hero,
  art,
  money,
  link,
}: {
  headline: string;
  hero?: string | null;
  art?: string;
  money?: React.ReactNode;
  link?: RaceView["payout"];
}) {
  const router = useRouter();
  const again = () => {
    let seated = false;
    try {
      seated = !!sessionStorage.getItem("rbola.race.track");
    } catch {}
    router.push(seated ? "/race/car" : "/race");
  };
  const img = hero ?? art;
  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{
        background: "#0A0A0F",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)",
      }}
    >
      {img && (
        <div className="rl-fade pointer-events-none absolute inset-x-0 top-0 h-[64%] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            style={{
              filter: hero
                ? "brightness(.7) saturate(.85)"
                : "brightness(.4) saturate(.7)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg,rgba(10,10,15,.35) 0%,rgba(10,10,15,0) 30%,rgba(10,10,15,.6) 70%,#0A0A0F 100%)",
            }}
          />
        </div>
      )}

      <div className="relative flex flex-1 flex-col justify-end gap-5 px-7 pb-10">
        <h1
          className="rl-rise text-[44px] font-light leading-[1.02] text-foreground-bright"
          style={{ letterSpacing: "-.01em", animationDelay: ".15s" }}
        >
          {headline}
        </h1>
        {money && (
          <div className="rl-rise" style={{ animationDelay: ".35s" }}>
            {money}
          </div>
        )}
        {link && (
          <div
            className="rl-fade h-[14px]"
            style={{ animationDelay: "1.4s" }}
          >
            {link.status === "sent" && link.sig ? (
              <a
                href={explorer(link.sig)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[9px] tracking-[.22em] text-foreground/40 transition-colors hover:text-foreground/70"
              >
                VIEW ON SOLANA EXPLORER ↗
              </a>
            ) : (
              <span className="rl-breathe font-mono text-[9px] tracking-[.22em] text-foreground/40">
                SETTLING ON CHAIN
              </span>
            )}
          </div>
        )}
      </div>

      <div className="relative px-5">
        <button
          onClick={again}
          className="rl-fade flex h-[54px] w-full items-center justify-center rounded-[15px] transition-transform active:scale-[.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{
            animationDelay: ".8s",
            background: "#14141A",
            border: "1px solid rgba(201,179,126,.6)",
            boxShadow:
              "0 10px 30px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
          }}
        >
          <span className="pl-[.3em] font-mono text-[12px] font-semibold tracking-[.3em] text-foreground">
            RACE AGAIN
          </span>
        </button>
      </div>
    </div>
  );
}

// ---------- pieces ----------

// odometer roll: each digit column rolls up from 0 to its value (right-most
// digit first)
function Odometer({
  text,
  unit,
  gold,
  muted,
}: {
  text: string;
  unit: string;
  gold?: boolean;
  muted?: boolean; // a loss: settled figure, no roll
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() =>
      requestAnimationFrame(() => setOn(true)),
    );
    return () => cancelAnimationFrame(r);
  }, []);
  const chars = [...text];
  const digitsTotal = chars.filter((c) => /\d/.test(c)).length;
  let d = 0;
  return (
    <span
      className="flex items-baseline gap-[10px] font-mono tabular-nums"
      aria-label={`${text} ${unit}`}
    >
      <span
        className="flex text-[26px] font-light leading-none"
        style={{
          color: gold ? "#C9B37E" : muted ? "rgba(242,241,238,.4)" : "#F2F1EE",
        }}
        aria-hidden
      >
        {chars.map((c, i) => {
          if (!/\d/.test(c)) return <span key={i}>{c}</span>;
          const n = Number(c);
          const delay = 0.5 + (digitsTotal - 1 - d++) * 0.12;
          return (
            <span
              key={i}
              className="relative inline-block h-[1em] overflow-hidden"
            >
              <span className="invisible">0</span>
              <span
                className="absolute left-0 top-0 flex flex-col"
                style={{
                  transform: `translateY(${on || muted ? -n : 0}em)`,
                  transition: `transform 1.6s cubic-bezier(.16,1,.3,1) ${delay}s`,
                }}
              >
                {Array.from({ length: 10 }, (_, k) => (
                  <span key={k} className="block h-[1em]">
                    {k}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="font-mono text-[10px] tracking-[.24em] text-foreground/50">
        {unit}
      </span>
    </span>
  );
}

function CarPhoto({
  src,
  fallback,
  unknown,
}: {
  src: string | null;
  fallback?: string;
  unknown?: boolean;
}) {
  const url = src ?? fallback;
  if (!url) return <div className="absolute inset-0 bg-[#0D0D12]" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      draggable={false}
      className="absolute inset-0 h-full w-full select-none object-cover"
      // no photo (house cars): the ground itself, in shadow
      style={
        unknown || !src
          ? { filter: "brightness(.38) saturate(.5) blur(2px)", transform: "scale(1.06)" }
          : undefined
      }
    />
  );
}

function stripPrefix(name: string) {
  return name.replace(/^RBOLA · /, "");
}
