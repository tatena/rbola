"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { useRaceWatch, type RaceView } from "@/lib/useRaceEntry";
import { Marcellus } from "next/font/google";
import "../live.css";

const marcellus = Marcellus({ weight: "400", subsets: ["latin"] });

// Race flow after the commit (race-logic.md §5, locked 10-08):
// MATCHMAKING (finding an opponent → VS) → race → RESULT.
// Keyed by entry id and driven only by GET /api/race/entry/[id], so a reload
// lands on the right beat. The result is decided server-side before the race
// beat plays — VS + race are pure theatre. Text stays on a hard budget; no
// performance numbers, SOL amounts are the only figures on screen.

const TRACK_ART: Record<string, string> = {
  "MOUNTAIN PASS": "/tracks/mountain.jpg",
  "HIGHWAY RUN": "/tracks/highway.jpg",
  "DRAG STRIP": "/tracks/drag.jpg",
};

// race footage per track (founder-generated, H.264 portrait crop); tracks
// without one fall back to the track-art push
const TRACK_VIDEO: Record<string, string> = {
  "MOUNTAIN PASS": "/races/mountain.mp4",
};

const RACE_MS = 4200;
const VIDEO_MAX_MS = 16000; // safety net if the footage stalls
const seenKey = (id: string) => `rbola.race.seen.${id}`;

const sol = (lamports: number) => {
  const s = (lamports / 1e9).toFixed(3);
  return s.endsWith("0") ? s.slice(0, -1) : s;
};

const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// Matchmaking v3 (Claude Design, 10-10): one stage from SEARCHING to the
// race. The empty seat waits on the right while your card sits forward-left;
// on match the rival's card drops in face-down, flips, the driver name lands,
// then the cards fall away and the track title pushes forward into the race.
type Beat =
  | "reset"
  | "search"
  | "found"
  | "drop"
  | "flip"
  | "vs"
  | "go"
  | "out"
  | "race"
  | "result";

// ms after the match lands (design sequence, rebased from found = 5600)
const MATCH_STEPS: Array<[number, Beat]> = [
  [0, "found"],
  [700, "drop"],
  [1800, "flip"],
  [3600, "vs"],
  [7600, "go"],
  [9200, "out"],
  [10300, "race"],
];

// plays the sequence once per entry per tab, then rests on the result; a
// reload after the result skips straight to it (per-tab convenience only)
// the race beat ends on its own clock (art) or when the footage ends (video)
function useTheatre(id: string, matched: boolean, video: boolean) {
  const [beat, setBeat] = useState<Beat>("reset");
  useEffect(() => {
    const t = setTimeout(
      () => setBeat((b) => (b === "reset" ? "search" : b)),
      700,
    );
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!matched) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey(id)) === "1";
    } catch {}
    const end = 10300 + (video ? VIDEO_MAX_MS : RACE_MS);
    const steps: Array<[number, Beat]> = seen
      ? [[0, "result"]]
      : [...MATCH_STEPS, [end, "result"]];
    const timers = steps.map(([ms, b]) => setTimeout(() => setBeat(b), ms));
    return () => timers.forEach(clearTimeout);
  }, [id, matched, video]);
  useEffect(() => {
    if (beat !== "result") return;
    try {
      sessionStorage.setItem(seenKey(id), "1");
    } catch {}
  }, [beat, id]);
  const finish = useCallback(
    () => setBeat((b) => (b === "race" ? "result" : b)),
    [],
  );
  return { beat, finish };
}

export default function RaceLive() {
  const { id } = useParams<{ id: string }>();
  const { view, error, cancel, cancelling } = useRaceWatch(id);
  const video = view ? TRACK_VIDEO[view.track] : undefined;
  const { beat, finish } = useTheatre(id, view?.status === "matched", !!video);

  if (!view) {
    return error ? (
      <Ending headline="Race not found" />
    ) : (
      <div className="min-h-dvh bg-background" />
    );
  }
  if (view.status === "cancelled") return <Left view={view} />;
  // the race beat escapes the page-enter transform (which would trap
  // position:fixed) and covers the nav
  if (beat === "race")
    return createPortal(
      video ? (
        <RaceFootage src={video} onDone={finish} />
      ) : (
        <RaceBeat view={view} />
      ),
      document.body,
    );
  if (beat === "result" && view.status === "matched")
    return <Result view={view} />;
  return (
    <Matchmaking
      view={view}
      beat={
        view.status === "matched" ? beat : beat === "reset" ? "reset" : "search"
      }
      cancel={cancel}
      cancelling={cancelling}
      preload={view.status === "matched" ? video : undefined}
    />
  );
}

// ---------- MATCHMAKING — finding an opponent → VS ----------

const CLUSTER_W = 360;
const CLUSTER_H = 590;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const SHEEN =
  "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.1),rgba(255,255,255,0))";
const GLOSS =
  "linear-gradient(147deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,0) 34%,rgba(255,255,255,0) 66%,rgba(255,255,255,.035) 100%)";

function Matchmaking({
  view,
  beat,
  cancel,
  cancelling,
  preload,
}: {
  view: RaceView;
  beat: Beat;
  cancel: () => void;
  cancelling: boolean;
  preload?: string; // race footage, fetched during VS so it starts instantly
}) {
  const has = (...b: Beat[]) => b.includes(beat);
  const searching = has("reset", "search");
  const vs = has("vs", "go", "out");
  const go = has("go", "out");
  const away = go || beat === "reset";
  const canCancel =
    searching &&
    (view.status === "searching" || view.status === "awaiting_payment");
  const art = TRACK_ART[view.track];
  const opp = view.opponent;

  // the card cluster is drawn at 402-wide design scale and shrinks to fit
  const stage = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () =>
      setK(
        Math.min(1, el.clientWidth / CLUSTER_W, el.clientHeight / CLUSTER_H),
      );
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardGo = {
    transition: `transform 1.6s ${EASE}, opacity 1.4s ease`,
    transform: go
      ? "scale(.96)"
      : beat === "reset"
        ? "translateY(18px)"
        : "none",
    opacity: away ? 0 : 1,
  };

  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden"
      style={{
        background: "#0A0A0F",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 79px)",
      }}
    >
      {/* the ground you chose */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          transition: "transform 8s cubic-bezier(.25,.1,.25,1)",
          transform: vs ? "scale(1.06)" : "scale(1)",
        }}
      >
        <div
          className="mm-drift absolute inset-0"
          style={{ filter: "saturate(.85) contrast(1.08)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art} alt="" className="h-full w-full object-cover" />
        </div>
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,rgba(10,10,15,.5) 0%,rgba(10,10,15,.66) 40%,rgba(10,10,15,.8) 72%,#0A0A0F 94%)",
          }}
        />
        <div
          className="absolute inset-0 bg-[#0A0A0F]"
          style={{
            transition: "opacity 1.8s ease",
            opacity: go ? 0 : vs ? 0.12 : 0.38,
          }}
        />
      </div>

      {/* LEAVE */}
      <div className="relative h-[46px] px-5 pt-[14px]">
        {canCancel && (
          <button
            onClick={cancel}
            disabled={cancelling}
            className="flex items-center gap-[10px] focus-visible:outline-none disabled:opacity-50"
            style={{ transition: "opacity .5s ease" }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-[.5px] border-[rgba(233,231,226,.18)]">
              <span
                className="ml-[3px] h-2 w-2 rotate-45 border-b border-l"
                style={{ borderColor: "rgba(242,241,238,.7)" }}
              />
            </span>
            <span className="font-mono text-[8.5px] tracking-[.28em] text-foreground/50">
              {cancelling ? "LEAVING" : "LEAVE"}
            </span>
          </button>
        )}
      </div>

      {/* track title — pushes forward into the race on GO */}
      <div
        className="relative z-[2] flex h-[68px] items-start justify-center pt-[14px]"
        style={{
          transition: `transform 1.6s ${EASE}`,
          transform: go ? "translateY(250px) scale(1.25)" : "none",
        }}
      >
        <span
          className={`${marcellus.className} pl-[.32em] text-[24px] leading-none tracking-[.32em] text-foreground`}
        >
          {view.track}
        </span>
      </div>

      {/* the two seats */}
      <div ref={stage} className="relative min-h-0 flex-1">
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: CLUSTER_W,
            height: CLUSTER_H,
            transform: `translate(-50%,-50%) scale(${k})`,
          }}
        >
          {/* rival seat — empty while searching, the rival's card on match */}
          <div
            className="absolute left-[136px] top-0 h-[354px] w-[224px]"
            style={cardGo}
          >
            <svg
              width="224"
              height="354"
              viewBox="0 0 224 354"
              fill="none"
              className="absolute inset-0 overflow-visible"
              style={{
                transition: "opacity .6s ease",
                opacity: has("reset", "search", "found", "drop") ? 1 : 0,
              }}
            >
              <rect
                x=".25"
                y=".25"
                width="223.5"
                height="353.5"
                rx="18"
                stroke="rgba(233,231,226,.42)"
                strokeWidth=".75"
              />
              <rect
                x="9"
                y="9"
                width="206"
                height="336"
                rx="11"
                stroke="rgba(201,179,126,.28)"
                strokeWidth=".5"
              />
            </svg>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-[22px]"
              style={{
                transition: "opacity .6s ease",
                opacity: searching ? 1 : 0,
              }}
            >
              <Wheel />
              <span className="pl-[.32em] text-center font-mono text-[7.5px] leading-[1.9] tracking-[.32em] text-foreground/50">
                FINDING AN
                <br />
                OPPONENT
              </span>
            </div>
            <div
              className="absolute inset-0 [perspective:1100px]"
              style={{
                transition: "opacity 1.2s ease",
                opacity: has("reset", "search", "found") ? 0 : 1,
              }}
            >
              <div
                className="absolute inset-0 [transform-style:preserve-3d]"
                style={{
                  transition: "transform 1.9s cubic-bezier(.65,0,.35,1)",
                  transform: has("flip", "vs", "go", "out")
                    ? "rotateY(0deg)"
                    : "rotateY(180deg)",
                }}
              >
                <div
                  className="absolute inset-0 overflow-hidden rounded-[18px] [backface-visibility:hidden]"
                  style={{
                    background: "#101016",
                    border: ".75px solid rgba(233,231,226,.5)",
                    boxShadow: "0 34px 70px rgba(0,0,0,.65)",
                  }}
                >
                  <CarPhoto
                    src={opp?.photo ?? null}
                    fallback={art}
                    unknown={!opp?.photo}
                  />
                  <Sheen
                    on={has("flip", "vs")}
                    across={has("flip", "vs", "go", "out")}
                    delay={1.4}
                  />
                  <span
                    className="absolute inset-x-0 top-0 h-[120px]"
                    style={{
                      background:
                        "linear-gradient(0deg,rgba(10,10,15,0),rgba(10,10,15,.8))",
                    }}
                  />
                  <span
                    className="absolute inset-0"
                    style={{ background: GLOSS }}
                  />
                  {opp?.rarity && (
                    <Badge className="bottom-3 right-3">{opp.rarity}</Badge>
                  )}
                  <span className="pointer-events-none absolute inset-[7px] rounded-[12px] border-[.5px] border-[rgba(233,231,226,.16)]" />
                  <span className="absolute inset-x-[14px] top-4 text-[13.5px] leading-[1.25] text-foreground-bright">
                    {opp ? stripPrefix(opp.name) : ""}
                  </span>
                </div>
                <div
                  className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[18px] [backface-visibility:hidden] [transform:rotateY(180deg)]"
                  style={{
                    background: "#0E0E13",
                    border: ".75px solid #C9B37E",
                  }}
                >
                  <span className="absolute inset-[9px] rounded-[11px] border-[.5px] border-[rgba(201,179,126,.22)]" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/rbola-r-mark.png"
                    alt=""
                    className="block w-[54px] opacity-80"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* rival driver */}
          <span
            className="absolute right-0 top-[370px] pl-[.28em] font-mono text-[9px] leading-none tracking-[.28em] text-foreground"
            style={{
              transition: `opacity .9s ease .6s, transform 1s ${EASE} .6s`,
              opacity: vs && !go ? 1 : 0,
              transform: vs ? "none" : "translateY(6px)",
            }}
          >
            {opp?.driver ?? ""}
          </span>

          {/* you — forward left */}
          <div
            className="absolute left-0 top-[236px] z-[3] h-[354px] w-[224px]"
            style={cardGo}
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-[18px]"
              style={{
                background: "#101016",
                border: ".75px solid rgba(233,231,226,.5)",
                boxShadow: "0 34px 70px rgba(0,0,0,.7)",
              }}
            >
              <CarPhoto src={view.car.photo} fallback={art} />
              <Sheen on={beat === "vs"} across={vs} delay={0.6} />
              <span
                className="absolute inset-x-0 bottom-0 h-[130px]"
                style={{
                  background:
                    "linear-gradient(180deg,rgba(10,10,15,0),rgba(10,10,15,.88))",
                }}
              />
              <span
                className="absolute inset-0"
                style={{ background: GLOSS }}
              />
              {view.car.rarity && (
                <Badge className="left-3 top-3">{view.car.rarity}</Badge>
              )}
              <span className="pointer-events-none absolute inset-[7px] rounded-[12px] border-[.5px] border-[rgba(233,231,226,.16)]" />
              <span className="absolute inset-x-[14px] bottom-[15px] text-[13.5px] leading-[1.25] text-foreground-bright">
                {stripPrefix(view.car.name)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {preload && (
        <video
          src={preload}
          muted
          playsInline
          preload="auto"
          className="hidden"
        />
      )}

      {/* fade to black into the race (the nav stays) */}
      <div
        className="pointer-events-none absolute inset-0 z-[7] bg-[#0A0A0F]"
        style={{
          transition: "opacity 1.1s ease",
          opacity: beat === "out" ? 1 : 0,
        }}
      />
    </div>
  );
}

// a slow-turning wheel in the empty seat
function Wheel() {
  return (
    <svg
      width="112"
      height="112"
      viewBox="0 0 120 120"
      fill="none"
      className="block overflow-visible"
    >
      <circle
        cx="60"
        cy="60"
        r="54"
        stroke="rgba(233,231,226,.2)"
        strokeWidth=".5"
      />
      <circle
        cx="60"
        cy="60"
        r="47"
        stroke="rgba(233,231,226,.12)"
        strokeWidth="6"
      />
      <path
        d="M88.5 31.5 A40 40 0 0 1 99.4 52"
        stroke="#C9B37E"
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity=".85"
      />
      <g className="mm-wheel">
        <circle
          cx="60"
          cy="60"
          r="43"
          stroke="rgba(242,241,238,.62)"
          strokeWidth=".75"
        />
        <circle
          cx="60"
          cy="60"
          r="39.5"
          stroke="rgba(242,241,238,.22)"
          strokeWidth=".5"
        />
        {[0, 72, 144, 216, 288].map((r) => (
          <path
            key={r}
            d="M57.2 47.5 L55 21.5 M62.8 47.5 L65 21.5"
            stroke="rgba(242,241,238,.6)"
            strokeWidth=".75"
            strokeLinecap="round"
            transform={`rotate(${r} 60 60)`}
          />
        ))}
        <circle
          cx="60"
          cy="60"
          r="13"
          stroke="rgba(242,241,238,.5)"
          strokeWidth=".75"
        />
        {[
          [64.7, 53.53],
          [67.61, 62.47],
          [60, 68],
          [52.39, 62.47],
          [55.3, 53.53],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r=".9" fill="rgba(242,241,238,.55)" />
        ))}
        <circle
          cx="60"
          cy="60"
          r="3.2"
          fill="#0A0A0F"
          stroke="#C9B37E"
          strokeWidth=".75"
        />
      </g>
    </svg>
  );
}

function Sheen({
  on,
  across,
  delay,
}: {
  on: boolean;
  across: boolean;
  delay: number;
}) {
  return (
    <span
      className="pointer-events-none absolute -top-[10%] left-0 h-[120%] w-[70px]"
      style={{
        background: SHEEN,
        opacity: on ? 1 : 0,
        transform: across
          ? "translateX(300px) skewX(-14deg)"
          : "translateX(-110px) skewX(-14deg)",
        transition: `transform 2.2s cubic-bezier(.45,0,.2,1) ${delay}s`,
      }}
    />
  );
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <span
      className={`absolute rounded-[4px] px-[6px] py-[3px] font-mono text-[7px] font-semibold leading-none tracking-[.22em] text-foreground ${className}`}
      style={{
        background: "rgba(10,10,15,.55)",
        border: ".5px solid rgba(233,231,226,.22)",
      }}
    >
      {children.toUpperCase()}
    </span>
  );
}

// ---------- RACE — the track's footage, start to finish ----------

function RaceFootage({ src, onDone }: { src: string; onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    // autoplay can be refused (e.g. iOS low-power mode): skip to the result
    ref.current?.play().catch(onDone);
  }, [onDone]);
  return (
    <div className="fixed inset-0 z-30 mx-auto w-full max-w-[430px] overflow-hidden bg-[#07070A]">
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        autoPlay
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration && v.duration - v.currentTime < 0.6) setFading(true);
        }}
        onEnded={onDone}
        onError={onDone}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%,rgba(7,7,10,0) 45%,rgba(7,7,10,.6) 100%)",
        }}
      />
      <div
        className="absolute inset-0 bg-[#0A0A0F]"
        style={{ transition: "opacity .5s ease", opacity: fading ? 1 : 0 }}
      />
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
    outcome === "win"
      ? "You won"
      : outcome === "tie"
        ? "Dead heat"
        : "Outpaced";

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
          <div className="rl-fade h-[14px]" style={{ animationDelay: "1.4s" }}>
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
          ? {
              filter: "brightness(.38) saturate(.5) blur(2px)",
              transform: "scale(1.06)",
            }
          : undefined
      }
    />
  );
}

function stripPrefix(name: string) {
  return name.replace(/^RBOLA · /, "");
}
