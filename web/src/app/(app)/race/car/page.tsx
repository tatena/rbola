"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOwner } from "@/lib/useOwner";
import { useRaceEntry } from "@/lib/useRaceEntry";
import RaceProgress from "../RaceProgress";

// Race flow step 3 — SELECT CAR (locked 2026-10-08: the garage 3D ring
// carousel reused, filtered to the seated rarity room; the ENTER CTA states
// the fee and is the entry commit). Ring math/markup adapted from
// garage/page.tsx — mint choreography dropped, provisional cards show the
// sealing veil and can't enter paid rooms (devnet flag aside).

type ApiCard = {
  assetId: string;
  name: string;
  photo: string | null;
  rarity: string | null;
  provisional?: boolean;
  stats: { speed: number; accel: number; handling: number } | null;
  lat: number | null;
  lon: number | null;
  time: string | null;
};

type CardVM = {
  key: string;
  name: string;
  img: string | null;
  num: string;
  rarity: string;
  date: string;
  place: string;
  stats: { label: string; value: number }[];
  provisional: boolean;
  hasSpecs: boolean; // pre-catalog catches have no spec and can't race
};

const ROOM_NAMES = ["COMMON", "SCARCE", "RARE", "EPIC", "LEGENDARY"];
const FEES = [0.01, 0.02, 0.05, 0.1, 0.25];

// race stats are SPEED/ACCEL/HANDLING only (deterministic lock) — the same
// catalog-derived values the race engine scores with
function statsFor(s: ApiCard["stats"]): { label: string; value: number }[] {
  return [
    { label: "Speed", value: s?.speed ?? 0 },
    { label: "Accel", value: s?.accel ?? 0 },
    { label: "Handling", value: s?.handling ?? 0 },
  ];
}

const CITIES = [
  "BERLIN",
  "MIAMI",
  "MONACO",
  "GOODWOOD",
  "TOKYO",
  "LONDON",
  "DUBAI",
  "MILAN",
];
function placeFor(
  lat: number | null | undefined,
  lon: number | null | undefined,
  seed: string,
) {
  if (typeof lat === "number" && typeof lon === "number") return "TBILISI";
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return CITIES[Math.abs(h) % CITIES.length];
}

function dateFor(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso)
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

function stripPrefix(name: string) {
  return name.replace(/^RBOLA · /, "");
}

const cardHairline = {
  height: ".5px",
  background:
    "linear-gradient(90deg, rgba(233,231,226,.32), rgba(233,231,226,.04))",
} as const;

export default function RaceCarSelect() {
  const router = useRouter();
  const [cards, setCards] = useState<ApiCard[] | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [raceProvisional, setRaceProvisional] = useState(false);
  const [tier, setTier] = useState<string | null>(null);

  const [turn, setTurn] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [flipDir, setFlipDir] = useState<"in" | "out" | null>(null);
  const lastFlipRef = useRef(0);
  const [snap, setSnap] = useState(true);
  const [scale, setScale] = useState(1);

  const stageRef = useRef<HTMLDivElement>(null);
  const pivotRef = useRef<HTMLDivElement>(null);
  const mountRefs = useRef<(HTMLDivElement | null)[]>([]);
  const swipeRef = useRef<{ x: number; t: number; f?: number } | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    setTier(sessionStorage.getItem("rbola.race.tier"));
  }, []);

  const { owner, pending } = useOwner();
  useEffect(() => {
    if (pending) return;
    fetch(`/api/garage${owner ? `?owner=${owner}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return;
        setCards(j.cards ?? []);
        setSol(j.sol ?? null);
        setRaceProvisional(!!j.raceProvisional);
      })
      .catch(() => {});
  }, [owner, pending]);

  useEffect(() => {
    const t = window.setTimeout(() => setSnap(false), 80);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(1, r.height / 620, r.width / 402));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // arriving without a seated tier (deep link) falls back to practice
  const isPractice = tier === "R" || tier == null;
  const roomIdx = tier != null && tier !== "R" ? Number(tier) : null;
  const roomName = roomIdx != null ? ROOM_NAMES[roomIdx] : null;
  const fee = roomIdx != null ? FEES[roomIdx] : 0;

  const vms = useMemo<CardVM[]>(() => {
    const pool = [...(cards ?? [])]
      .filter((c) =>
        roomName == null ? true : (c.rarity ?? "").toUpperCase() === roomName,
      )
      .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
    // devnet (server flag): provisional cards race like settled ones, so they
    // show as normal cards; on mainnet the veil and gate return
    return pool.map((c) => {
      const veiled = !!c.provisional && !raceProvisional;
      return {
        key: c.assetId,
        name: stripPrefix(c.name),
        img: c.photo,
        num: `#${c.assetId.slice(-4).toUpperCase()}`,
        rarity: veiled ? "SEALING" : (c.rarity ?? "RARE").toUpperCase(),
        date: dateFor(c.time),
        place: placeFor(c.lat, c.lon, c.assetId),
        stats: statsFor(veiled ? null : c.stats),
        provisional: veiled,
        hasSpecs: c.stats != null,
      };
    });
  }, [cards, roomName, raceProvisional]);

  // ring geometry — identical to the garage (virtualized to 5 mounts)
  const N = vms.length;
  const active = N > 0 ? ((turn % N) + N) % N : 0;
  const S = Math.min(N, 5);
  const step = S > 0 ? 360 / S : 360;
  const sFront = S > 0 ? ((turn % S) + S) % S : 0;
  const halfS = Math.floor(S / 2);
  const ringMove = "transform .28s cubic-bezier(.25,.5,.3,1)";

  function sdOf(s: number, t: number) {
    let d = (((s - t) % S) + S) % S;
    if (d > S / 2) d -= S;
    return d;
  }
  const pivotT = (t: number) => `rotateY(${-t * step}deg)`;
  const mountT = (s: number, t: number) => {
    const d = sdOf(s, t);
    return `rotateY(${s * step}deg) translateZ(202px) rotateY(${
      -d * step * 0.55
    }deg) translateX(${d * 97}px)`;
  };

  function go(delta: number) {
    if (N <= 1) return;
    setTurn((t) => t + delta);
    setFlipped(false);
    setFlipDir(null);
  }
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goRef.current(-1);
      else if (e.key === "ArrowRight") goRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function slotTap(sd: number, vm: CardVM) {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    if (sd !== 0) {
      go(sd);
      return;
    }
    if (vm.provisional) return; // sealed specs — nothing to flip to
    const now = performance.now();
    if (now - lastFlipRef.current < 900) return;
    lastFlipRef.current = now;
    setFlipDir(flipped ? "out" : "in");
    setFlipped((f) => !f);
  }

  const PX_PER_CARD = 240;
  function eachMount(fn: (el: HTMLDivElement, s: number) => void) {
    mountRefs.current.forEach((el, s) => el && fn(el, s));
  }
  function swipeDown(e: React.PointerEvent) {
    if (N <= 1) return;
    swipeRef.current = { x: e.clientX, t: turn };
    movedRef.current = false;
  }
  function swipeMove(e: React.PointerEvent) {
    const st = swipeRef.current;
    if (!st) return;
    const delta = st.x - e.clientX;
    if (Math.abs(delta) > 8 && !movedRef.current) {
      movedRef.current = true;
      if (flipped) {
        setFlipped(false);
        setFlipDir(null);
      }
    }
    if (!movedRef.current) return;
    const tFloat = st.t + delta / PX_PER_CARD;
    swipeRef.current = { ...st, f: tFloat };
    const pivot = pivotRef.current;
    if (pivot) {
      pivot.style.transition = "none";
      pivot.style.transform = pivotT(tFloat);
    }
    eachMount((el, s) => {
      el.style.transition = "none";
      el.style.transform = mountT(s, tFloat);
    });
  }
  function swipeUp() {
    const st = swipeRef.current;
    swipeRef.current = null;
    if (!st) return;
    const target = Math.round(st.f ?? st.t);
    const pivot = pivotRef.current;
    if (pivot) pivot.style.transition = ringMove;
    eachMount((el) => {
      el.style.transition = `opacity .45s ease, ${ringMove}`;
    });
    if (target !== turn) {
      setTurn(target);
      setFlipped(false);
      setFlipDir(null);
    } else {
      requestAnimationFrame(() => {
        if (pivot) pivot.style.transform = pivotT(turn);
        eachMount((el, s) => {
          el.style.transform = mountT(s, turn);
        });
      });
    }
  }

  const race = useRaceEntry();
  const activeVM = N > 0 ? vms[active] : null;
  const gated = !!activeVM?.provisional && !isPractice && !raceProvisional;
  const busy = race.phase === "signing" || race.phase === "entering";
  const noSpecs = !!activeVM && !activeVM.hasSpecs;
  const ctaDead = !activeVM || gated || noSpecs || busy;
  const ctaLabel =
    race.phase === "signing"
      ? "CONFIRM IN WALLET"
      : race.phase === "entering"
        ? "ENTERING"
        : race.phase === "error"
          ? (race.error ?? "TRY AGAIN").toUpperCase()
          : noSpecs
            ? "NO SPECS YET"
            : gated
              ? "SPECS NOT SETTLED"
              : isPractice
                ? "PRACTICE"
                : `ENTER · ${fee.toFixed(2)} SOL`;

  // commit → the live screen (searching → VS → race → result), keyed by the
  // entry id so it survives a reload
  const onEnter = async () => {
    if (race.phase === "error") return race.reset();
    if (ctaDead || !activeVM) return;
    sessionStorage.setItem("rbola.race.car", activeVM.key);
    const id = await race.enter({
      owner,
      assetId: activeVM.key,
      track: sessionStorage.getItem("rbola.race.track") ?? "HIGHWAY RUN",
      room: isPractice ? "practice" : roomName!.toLowerCase(),
    });
    if (id) router.push(`/race/live/${id}`);
  };

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden text-foreground"
      style={{
        background: "linear-gradient(180deg,#0A0A0F,#101015)",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)",
      }}
    >
      {/* header */}
      <div className="relative flex items-center justify-between px-5 pt-[6px]">
        <button
          onClick={() => router.push("/race/tier")}
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
            SELECT CAR
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

      <RaceProgress step={2} />

      {/* ring stage */}
      <div
        ref={stageRef}
        className="relative mt-2 min-h-0 flex-1"
        style={{ touchAction: "pan-y" }}
        onPointerDown={swipeDown}
        onPointerMove={swipeMove}
        onPointerUp={swipeUp}
        onPointerCancel={swipeUp}
      >
        {N === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
            {cards === null ? (
              <span className="animate-pulse font-mono text-[10px] tracking-[.24em] text-[rgba(242,241,238,.4)]">
                OPENING GARAGE
              </span>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span className="font-mono text-[10px] tracking-[.2em] text-[rgba(242,241,238,.4)]">
                  NO CARS IN THIS TIER
                </span>
                <button
                  onClick={() => router.push("/race/tier")}
                  className="font-mono text-[9px] tracking-[.2em] text-accent"
                >
                  SHIFT INTO ANOTHER
                </button>
              </div>
            )}
          </div>
        )}

        <div
          className="absolute inset-0"
          style={{ transform: `scale(${scale})` }}
        >
          <div
            className="keep-3d-alive absolute inset-0"
            style={{ perspective: "1500px" }}
          >
            <div
              ref={pivotRef}
              className="absolute left-1/2 top-1/2 h-0 w-0"
              style={{
                transformStyle: "preserve-3d",
                willChange: "transform",
                transition: snap ? "none" : ringMove,
                transform: pivotT(turn),
              }}
            >
              {Array.from({ length: S }, (_, s) => {
                const sd = ((s - sFront + halfS + S) % S) - halfS;
                const cardIdx = (((active + sd) % N) + N) % N;
                const vm = vms[cardIdx];
                if (!vm) return null;
                const vis = Math.abs(sd) <= 1;
                const isActive = sd === 0;
                const showBack = isActive && flipped && !vm.provisional;
                return (
                  <div
                    key={`slot-${s}`}
                    ref={(el) => {
                      mountRefs.current[s] = el;
                    }}
                    onClick={() => slotTap(sd, vm)}
                    className="absolute cursor-pointer"
                    style={{
                      left: -135,
                      top: -250,
                      width: 270,
                      height: 500,
                      transformStyle: "preserve-3d",
                      willChange: "transform",
                      transform: mountT(s, turn),
                      transition: snap
                        ? "none"
                        : `opacity .45s ease, ${ringMove}`,
                      opacity: 1,
                      pointerEvents: vis ? "auto" : "none",
                    }}
                  >
                    <div
                      className={`absolute inset-0 ${
                        isActive && flipDir
                          ? flipDir === "in"
                            ? "flip-zoom-in"
                            : "flip-zoom-out"
                          : ""
                      }`}
                      style={{
                        transformStyle: "preserve-3d",
                        transform:
                          isActive && flipDir
                            ? undefined
                            : showBack
                              ? "translateZ(70px)"
                              : "none",
                      }}
                    >
                      <div
                        className={`absolute inset-0 ${
                          isActive && flipDir
                            ? flipDir === "in"
                              ? "flip-rot-in"
                              : "flip-rot-out"
                            : ""
                        }`}
                        style={{
                          transformStyle: "preserve-3d",
                          transform:
                            isActive && flipDir
                              ? undefined
                              : showBack
                                ? "rotateX(180deg)"
                                : "rotateX(0deg)",
                        }}
                      >
                        {/* front */}
                        <div
                          className="absolute inset-0 overflow-hidden rounded-[22px]"
                          style={{
                            background: "#101016",
                            border: ".5px solid rgba(233,231,226,.34)",
                            boxShadow:
                              "0 26px 60px rgba(0,0,0,.6), inset 0 .5px 0 rgba(255,255,255,.14)",
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                            visibility: showBack ? "hidden" : "visible",
                            transition: "visibility 0s linear .35s",
                          }}
                        >
                          <div
                            className="pointer-events-none absolute inset-0 z-[3] rounded-[22px]"
                            style={{
                              background:
                                "linear-gradient(147deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 34%, rgba(255,255,255,0) 66%, rgba(255,255,255,.035) 100%)",
                            }}
                          />
                          <div
                            className="card-sheen pointer-events-none absolute left-0 top-0 z-[4] h-full w-[52px]"
                            style={{
                              background:
                                "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.055), rgba(255,255,255,0))",
                            }}
                          />
                          <div
                            className="absolute left-0 right-0 top-0 h-[376px] overflow-hidden rounded-t-[22px]"
                            style={{
                              transition: "filter .4s ease",
                              filter: vm.provisional
                                ? "blur(3.5px) saturate(.62) brightness(.72)"
                                : "none",
                            }}
                          >
                            {vm.img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={vm.img}
                                alt={vm.name}
                                draggable={false}
                                className="h-full w-full select-none object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[#0D0D12] font-mono text-[9px] tracking-[.2em] text-[rgba(242,241,238,.3)]">
                                NO PHOTO
                              </div>
                            )}
                          </div>
                          <div
                            className="pointer-events-none absolute left-0 right-0 z-[2] h-[62px]"
                            style={{
                              top: 320,
                              background:
                                "linear-gradient(180deg, rgba(16,16,22,0), #101016)",
                            }}
                          />

                          {/* provisional veil — same language as the garage */}
                          <div
                            className="pointer-events-none absolute inset-0 z-[6] rounded-[22px]"
                            style={{
                              transition: "opacity .4s ease",
                              opacity: vm.provisional ? 0.82 : 0,
                              background:
                                "linear-gradient(180deg, rgba(7,7,10,.72), rgba(7,7,10,.86))",
                            }}
                          />
                          <div
                            className="pointer-events-none absolute left-0 right-0 top-1/2 z-[7] flex -translate-y-1/2 flex-col items-center"
                            style={{
                              transition: "opacity .4s ease",
                              opacity: vm.provisional ? 1 : 0,
                            }}
                          >
                            <span className="font-mono text-[9.5px] font-medium leading-none tracking-[.3em] text-[rgba(242,241,238,.72)]">
                              PROVISIONAL
                            </span>
                          </div>

                          <div className="absolute left-3 right-3 top-3 z-[5] flex items-start justify-between">
                            <span
                              className="rounded-[4px] px-2 py-1 font-mono text-[9px] font-semibold leading-none tracking-[.2em]"
                              style={{
                                background: "rgba(10,10,15,.72)",
                                border: ".5px solid rgba(233,231,226,.22)",
                              }}
                            >
                              {vm.rarity}
                            </span>
                          </div>

                          <div className="absolute bottom-0 left-0 right-0 z-[5] flex flex-col gap-[10px] px-[14px] pb-[15px]">
                            <div className="flex items-end justify-between">
                              <div className="flex flex-col gap-1">
                                <span
                                  className="text-[19px] font-normal leading-[1.15] text-foreground-bright"
                                  style={{ letterSpacing: ".005em" }}
                                >
                                  {vm.name}
                                </span>
                                <span className="font-mono text-[9.5px] leading-none tracking-[.16em] text-[rgba(242,241,238,.4)]">
                                  {vm.date}
                                </span>
                              </div>
                              <span className="font-mono text-[11px] font-medium leading-none tracking-[.06em] text-accent">
                                {vm.num}
                              </span>
                            </div>
                            <div style={cardHairline} />
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] font-medium leading-none tracking-[.13em] text-[rgba(242,241,238,.62)]">
                                {vm.place}
                              </span>
                              <span className="font-mono text-[9px] font-medium leading-none tracking-[.14em] text-[rgba(242,241,238,.3)]">
                                {vm.provisional ? "LOCKED" : "TAP FOR SPECS"}
                              </span>
                            </div>
                          </div>

                          <div
                            className="pointer-events-none absolute inset-0 z-[8] rounded-[22px] bg-[#07070A]"
                            style={{
                              transition: "opacity .6s ease",
                              opacity: isActive ? 0 : vis ? 0.38 : 1,
                            }}
                          />
                        </div>

                        {/* back (spec side) */}
                        <div
                          className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[22px] p-[18px] pb-4"
                          style={{
                            background:
                              "linear-gradient(168deg, #14141B, #0D0D12)",
                            border: ".5px solid rgba(233,231,226,.3)",
                            boxShadow:
                              "0 26px 60px rgba(0,0,0,.6), inset 0 .5px 0 rgba(255,255,255,.12)",
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                            transform: "rotateX(180deg)",
                            visibility: showBack ? "visible" : "hidden",
                            transition: "visibility 0s linear .35s",
                          }}
                        >
                          <div
                            className="pointer-events-none absolute inset-0"
                            style={{
                              background:
                                "linear-gradient(147deg, rgba(255,255,255,.05), rgba(255,255,255,0) 40%, rgba(255,255,255,.02))",
                            }}
                          />
                          <div className="flex items-start justify-between">
                            <div className="flex flex-col gap-[5px]">
                              <span className="font-mono text-[8.5px] font-medium leading-none tracking-[.24em] text-[rgba(242,241,238,.34)]">
                                SPECIFICATION
                              </span>
                              <span className="text-[16px] leading-[1.15] text-foreground-bright">
                                {vm.name}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] font-medium leading-none text-accent">
                              {vm.num}
                            </span>
                          </div>

                          <div style={cardHairline} />

                          <div className="flex flex-col gap-[17px]">
                            {vm.stats.map((s) => (
                              <div
                                key={s.label}
                                className="flex flex-col gap-[9px]"
                              >
                                <div className="flex items-baseline justify-between">
                                  <span
                                    className="text-[12.5px] leading-none text-[rgba(242,241,238,.7)]"
                                    style={{ letterSpacing: ".02em" }}
                                  >
                                    {s.label}
                                  </span>
                                  <span className="font-mono text-[14px] font-medium leading-none">
                                    {s.value}
                                  </span>
                                </div>
                                <span className="relative block h-[3px] rounded-[2px] bg-[rgba(242,241,238,.1)]">
                                  <span
                                    className="absolute left-0 top-0 h-[3px] rounded-[2px]"
                                    style={{
                                      transition:
                                        "width .5s cubic-bezier(.4,0,.2,1) .25s",
                                      background:
                                        "linear-gradient(90deg, rgba(233,231,226,.5), #E9E7E2)",
                                      width: showBack ? `${s.value}%` : "0%",
                                    }}
                                  />
                                </span>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-col">
                            <div
                              className="flex items-center justify-between py-[10px]"
                              style={{
                                borderTop: ".5px solid rgba(233,231,226,.1)",
                                borderBottom: ".5px solid rgba(233,231,226,.1)",
                              }}
                            >
                              <span className="font-mono text-[10.5px] leading-none tracking-[.14em] text-[rgba(242,241,238,.4)]">
                                RARITY
                              </span>
                              <span className="font-mono text-[9px] font-semibold leading-none tracking-[.2em]">
                                {vm.rarity}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* prev/next */}
      {N > 1 && (
        <div className="flex flex-none items-center justify-center gap-[18px] pt-2">
          <button
            onClick={() => go(-1)}
            aria-label="Previous card"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[17px] border-[.5px] border-[rgba(201,179,126,.4)] bg-[rgba(201,179,126,.08)] active:scale-[.94] focus-visible:outline-none"
          >
            <span
              className="ml-[3px] block h-[7px] w-[7px] rotate-45"
              style={{
                borderLeft: "1.3px solid #C9B37E",
                borderBottom: "1.3px solid #C9B37E",
              }}
            />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Next card"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[17px] border-[.5px] border-[rgba(201,179,126,.4)] bg-[rgba(201,179,126,.08)] active:scale-[.94] focus-visible:outline-none"
          >
            <span
              className="mr-[3px] block h-[7px] w-[7px] rotate-45"
              style={{
                borderRight: "1.3px solid #C9B37E",
                borderTop: "1.3px solid #C9B37E",
              }}
            />
          </button>
        </div>
      )}

      {/* ENTER — the commit tap: fee stated, escrow + matchmaking next */}
      <div className="px-5 pt-3">
        <button
          onClick={onEnter}
          className="flex h-[54px] w-full items-center justify-center rounded-[15px] transition-[opacity,transform] duration-300 active:scale-[.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{
            background: "#14141A",
            border: "1px solid rgba(201,179,126,.6)",
            boxShadow:
              "0 10px 30px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
            opacity: ctaDead ? 0.3 : 1,
            cursor: ctaDead ? "default" : "pointer",
          }}
        >
          <span className="pl-[.3em] font-mono text-[12px] font-semibold tracking-[.3em] text-foreground">
            {ctaLabel}
          </span>
        </button>
      </div>
    </div>
  );
}
