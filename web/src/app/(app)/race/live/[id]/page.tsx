"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { useRaceEntry, useRaceWatch, type RaceView } from "@/lib/useRaceEntry";
import { useOwner } from "@/lib/useOwner";
import { Marcellus } from "next/font/google";
import {
  TRACK_VIDEO,
  footageElement,
  primeFootage,
  unlockFootage,
  type Footage,
} from "@/lib/raceFootage";
import { explorerTx } from "@/lib/cluster";
import { cardNumber } from "@/lib/cardFace";
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

const RACE_MS = 4200;
const STALL_MS = 8000; // footage that stops making progress hands over to the result
const seenKey = (id: string) => `rbola.race.seen.${id}`;

// up to 4 decimals, trailing zeros dropped (0.0017, 0.001, 0.02)
const sol = (lamports: number) => String(+(lamports / 1e9).toFixed(4));

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
    // footage ends the race beat itself (RaceFootage → finish); the art beat
    // runs on its own clock
    const steps: Array<[number, Beat]> = seen
      ? [[0, "result"]]
      : video
        ? MATCH_STEPS
        : [...MATCH_STEPS, [10300 + RACE_MS, "result"]];
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
        <RaceFootage footage={video} view={view} onDone={finish} />
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
      preload={view.status === "matched" ? video?.src : undefined}
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
  useEffect(() => {
    if (preload) primeFootage(preload);
  }, [preload]);
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

function RaceFootage({
  footage,
  view,
  onDone,
}: {
  footage: Footage;
  view: RaceView;
  onDone: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fading, setFading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  // the shared element (unlocked for sound by the ENTER tap) plays here;
  // without that tap (e.g. a reload) it autoplays muted with a SOUND toggle
  useEffect(() => {
    const v = primeFootage(footage.src);
    v.className = `absolute inset-0 h-full w-full ${footage.fit === "cover" ? "object-cover" : "object-contain"}`;
    box.current?.prepend(v);
    let last = Date.now();
    const onTime = () => {
      last = Date.now();
      if (v.duration && v.duration - v.currentTime < 0.6) setFading(true);
    };
    const fail = () => setFailed(true);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onDone);
    v.addEventListener("error", fail);
    v.currentTime = 0;
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(fail);
    });
    // a stalled stream must not trap the player on a frozen frame
    const stall = setInterval(() => {
      if (Date.now() - last > STALL_MS) fail();
    }, 1000);
    return () => {
      clearInterval(stall);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onDone);
      v.removeEventListener("error", fail);
      v.pause();
      v.remove();
    };
  }, [footage, onDone]);

  // footage unavailable: the track-art beat, then the result
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(onDone, RACE_MS);
    return () => clearTimeout(t);
  }, [failed, onDone]);
  if (failed) return <RaceBeat view={view} />;

  return (
    <div
      ref={box}
      className="fixed inset-0 z-30 mx-auto w-full max-w-[430px] overflow-hidden bg-[#07070A]"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%,rgba(7,7,10,0) 45%,rgba(7,7,10,.6) 100%)",
        }}
      />
      {muted && (
        <button
          onClick={() => {
            footageElement().muted = false;
            setMuted(false);
          }}
          className="absolute right-5 top-[max(env(safe-area-inset-top),16px)] z-[2] mt-[14px] rounded-full border-[.5px] border-[rgba(233,231,226,.25)] bg-[rgba(10,10,15,.5)] px-[14px] py-[9px] pl-[calc(14px+.28em)] font-mono text-[8.5px] tracking-[.28em] text-foreground/80"
        >
          SOUND
        </button>
      )}
      <div
        className="pointer-events-none absolute inset-0 bg-[#0A0A0F]"
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

// Race Result (Claude Design, 10-12): the ground you raced on, the verdict
// letter by letter under the track name, your card with a ring drawn round
// it. A win stays in colour and the ring is gold; a loss drains to grey.
// No figures on screen.
function Result({ view }: { view: RaceView }) {
  const router = useRouter();
  const again = useRaceAgain();
  const outcome = view.result!.outcome;
  const won = outcome === "win";
  const lost = outcome === "loss";
  const art = TRACK_ART[view.track];

  // the card is drawn at 402-wide design scale and shrinks to fit
  const stage = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () =>
      setK(Math.min(1, el.clientWidth / 244, el.clientHeight / 390));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const headline = won ? "YOU WON" : lost ? "YOU LOST" : "DEAD HEAT";

  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden"
      style={{
        background: "#0A0A0F",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 79px)",
      }}
    >
      {/* the ground you raced on */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="rr-drift absolute inset-0"
          style={{
            transform: "scale(1.06)",
            filter: lost
              ? "grayscale(1) brightness(.75)"
              : "saturate(.85) contrast(1.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art} alt="" className="h-full w-full object-cover" />
        </div>
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,rgba(10,10,15,.6) 0%,rgba(10,10,15,.78) 40%,rgba(10,10,15,.92) 70%,#0A0A0F 88%)",
          }}
        />
      </div>

      {/* track + verdict */}
      <div className="relative flex flex-col items-center gap-3 pt-[40px]">
        <span
          className={`${marcellus.className} rl-fade pl-[.32em] text-[13px] leading-none tracking-[.32em] text-foreground/60`}
          style={{ animationDelay: ".1s", animationDuration: "1s" }}
        >
          {view.track}
        </span>
        <h1
          className="flex pl-[.14em] font-extralight leading-none tracking-[.14em]"
          style={{
            fontSize: "min(46px, 11vw)",
            color: won ? "#C9B37E" : "rgba(242,241,238,.7)",
          }}
          aria-label={headline}
        >
          {[...headline].map((ch, i) => (
            <span
              key={i}
              aria-hidden
              className={`inline-block whitespace-pre ${won ? "rr-in-up" : "rr-in-down"}`}
              style={{ animationDelay: `${0.5 + i * 0.07}s` }}
            >
              {ch}
            </span>
          ))}
        </h1>
      </div>

      {/* your card */}
      <div ref={stage} className="relative my-6 min-h-0 flex-1">
        <div
          className="absolute left-1/2 top-1/2 h-[390px] w-[244px]"
          style={{ transform: `translate(-50%,-50%) scale(${k})` }}
        >
          <div
            className={`relative h-full w-full ${won ? "rr-card-win" : "rr-card-rest"}`}
            style={{ transform: won ? undefined : "scale(.96)" }}
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-[20px]"
              style={{
                background: "#101016",
                border: ".5px solid rgba(233,231,226,.3)",
                boxShadow: won
                  ? "0 0 70px rgba(201,179,126,.14),0 34px 70px rgba(0,0,0,.65)"
                  : "0 34px 70px rgba(0,0,0,.65)",
              }}
            >
              <div
                className="absolute inset-x-0 top-0 h-[300px]"
                style={{
                  filter: lost ? "grayscale(1) brightness(.8)" : undefined,
                }}
              >
                <CarPhoto src={view.car.photo} fallback={art} />
              </div>
              <span
                className="absolute inset-x-0 top-[250px] h-[52px]"
                style={{
                  background:
                    "linear-gradient(180deg,rgba(16,16,22,0),#101016)",
                }}
              />
              <span
                className="pointer-events-none absolute inset-0"
                style={{ background: GLOSS }}
              />
              {won && (
                <span
                  className="rr-sheen pointer-events-none absolute left-0 top-0 h-full w-[70px] opacity-0"
                  style={{
                    background:
                      "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.12),rgba(255,255,255,0))",
                  }}
                />
              )}
              {view.car.rarity && (
                <Badge className="left-3 top-3">{view.car.rarity}</Badge>
              )}
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[11px] px-4 pb-4">
                <div className="flex items-end justify-between gap-[10px]">
                  <span className="text-[17px] leading-[1.15] text-foreground-bright">
                    {stripPrefix(view.car.name)}
                  </span>
                  {view.car.assetId && (
                    <span className="shrink-0 font-mono text-[10px] font-medium leading-none tracking-[.14em] text-accent">
                      {cardNumber(view.car.assetId)}
                    </span>
                  )}
                </div>
                <span
                  className="h-[.5px]"
                  style={{
                    background:
                      "linear-gradient(90deg,rgba(233,231,226,.32),rgba(233,231,226,.04))",
                  }}
                />
                {view.car.place && (
                  <span className="font-mono text-[9px] font-medium leading-none tracking-[.2em] text-foreground/55">
                    {view.car.place}
                  </span>
                )}
              </div>
            </div>
            <svg
              width="244"
              height="390"
              viewBox="0 0 244 390"
              fill="none"
              className="pointer-events-none absolute inset-0 overflow-visible"
            >
              <rect
                className="rr-ring"
                x=".4"
                y=".4"
                width="243.2"
                height="389.2"
                rx="20"
                stroke={won ? "#C9B37E" : "rgba(242,241,238,.22)"}
                strokeWidth="1"
                pathLength={100}
                strokeDasharray="100 100"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* actions */}
      <div
        className="rl-rise relative flex flex-col items-center gap-[6px] px-5"
        style={{ animationDelay: "1.6s" }}
      >
        <button
          onClick={again}
          className="flex h-[54px] w-full items-center justify-center gap-3 rounded-[15px] transition-[transform,background-color] hover:bg-[#191920] active:scale-[.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{
            background: "#14141A",
            border: `1px solid ${won ? "rgba(201,179,126,.6)" : "rgba(233,231,226,.22)"}`,
            boxShadow:
              "0 10px 30px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            className="block text-accent"
            aria-hidden
          >
            <path
              d="M5.5 21V4M5.5 5c2.1-1.3 4.3-1.3 6.5 0s4.4 1.3 6.5 0v8.6c-2.1 1.3-4.3 1.3-6.5 0s-4.4-1.3-6.5 0z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="pl-[.3em] font-mono text-[12px] font-semibold tracking-[.3em] text-foreground">
            RACE AGAIN
          </span>
        </button>
        <button
          onClick={() => router.push("/garage")}
          className="flex h-[44px] items-center justify-center px-4 pl-[calc(1rem+.3em)] font-mono text-[9.5px] font-medium tracking-[.3em] text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-none"
        >
          BACK TO GARAGE
        </button>
      </div>
    </div>
  );
}

// back into the race: straight to car select when a track is already chosen
function useRaceAgain() {
  const router = useRouter();
  return () => {
    let seated = false;
    try {
      seated = !!sessionStorage.getItem("rbola.race.track");
    } catch {}
    router.push(seated ? "/race/car" : "/race");
  };
}

function Left({ view }: { view: RaceView }) {
  const p = view.payout;
  const noRival = view.reason === "no_rival";
  return (
    <Ending
      headline={noRival ? "No rival on the line" : "Left the queue"}
      action={noRival && view.car.assetId ? <HouseRace view={view} /> : null}
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

// paid search came back empty (refunded): run the same car on the same
// track against a house car, free — the race is never out of reach
function HouseRace({ view }: { view: RaceView }) {
  const router = useRouter();
  const { owner } = useOwner();
  const race = useRaceEntry();
  const go = async () => {
    unlockFootage(view.track); // inside the tap, before any await (sound)
    const id = await race.enter({
      owner,
      assetId: view.car.assetId!,
      track: view.track,
      room: "practice",
    });
    if (id) router.push(`/race/live/${id}`);
  };
  const busy = race.phase === "entering";
  return (
    <button
      onClick={go}
      disabled={busy}
      className="rl-fade mb-3 flex h-[54px] w-full items-center justify-center rounded-[15px] transition-transform active:scale-[.97] disabled:opacity-60"
      style={{
        animationDelay: ".6s",
        background: "rgba(201,179,126,.1)",
        border: "1px solid rgba(201,179,126,.6)",
      }}
    >
      <span className="pl-[.3em] font-mono text-[12px] font-semibold tracking-[.3em] text-accent">
        {busy ? "STARTING" : race.error ? "TRY AGAIN" : "RACE THE HOUSE · FREE"}
      </span>
    </button>
  );
}

// the shared resting frame: image up top, one headline, one money line,
// a quiet receipt link, an optional action, RACE AGAIN
function Ending({
  headline,
  art,
  money,
  link,
  action,
}: {
  headline: string;
  art?: string;
  money?: React.ReactNode;
  link?: RaceView["payout"];
  action?: React.ReactNode;
}) {
  const again = useRaceAgain();
  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{
        background: "#0A0A0F",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)",
      }}
    >
      {art && (
        <div className="rl-fade pointer-events-none absolute inset-x-0 top-0 h-[64%] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={art}
            alt=""
            className="h-full w-full object-cover"
            style={{
              filter: "brightness(.4) saturate(.7)",
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
                href={explorerTx(link.sig)}
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
        {action}
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
}: {
  text: string;
  unit: string;
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
          color: "#F2F1EE",
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
                  transform: `translateY(${on ? -n : 0}em)`,
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
