"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getDraft,
  getServerDraft,
  subscribe,
  retryMint,
  clearDraft,
  getGarageCache,
  setGarageCache,
} from "@/lib/mintStore";
import { useOwner } from "@/lib/useOwner";

type ApiCard = {
  assetId: string;
  name: string;
  photo: string | null;
  rarity: string | null;
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
  sealing: boolean;
  mintFailed: boolean;
};

const STAT_LABELS = ["Speed", "Handling", "Condition"];

// deterministic placeholder stats per card until the real spec DB lands
function statsFor(seed: string | null): { label: string; value: number }[] {
  return STAT_LABELS.map((label, i) => {
    if (!seed) return { label, value: 0 };
    let h = 2166136261 ^ (i * 977);
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return { label, value: 40 + (Math.abs(h) % 58) };
  });
}

// placeholder until reverse geocoding lands — GPS catches read as Tbilisi,
// the rest get a stable pseudo-random city per card
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

export default function GaragePage() {
  const draft = useSyncExternalStore(subscribe, getDraft, getServerDraft);
  // start from the warm cache — the ring renders complete on arrival
  const [cards, setCards] = useState<ApiCard[] | null>(
    () => (getGarageCache()?.cards as ApiCard[] | undefined) ?? null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sol, setSol] = useState<number | null>(
    () => getGarageCache()?.sol ?? null,
  );

  const [turn, setTurn] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [flipDir, setFlipDir] = useState<"in" | "out" | null>(null);
  const lastFlipRef = useRef(0);
  const [snap, setSnap] = useState(true); // 0s transitions on arrival snap
  const [pct, setPct] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [scale, setScale] = useState(1);

  const stageRef = useRef<HTMLDivElement>(null);
  const pivotRef = useRef<HTMLDivElement>(null);
  const mountRefs = useRef<(HTMLDivElement | null)[]>([]);
  const swipeRef = useRef<{ x: number; t: number; f?: number } | null>(null);
  const movedRef = useRef(false);

  // garage follows the logged-in wallet; refetches when the session resolves
  const { owner, pending } = useOwner();
  function load() {
    setLoadError(null);
    fetch(`/api/garage${owner ? `?owner=${owner}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setCards(j.cards);
        setSol(j.sol ?? null);
        setGarageCache({ cards: j.cards ?? [], sol: j.sol ?? null });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }
  useEffect(() => {
    // hold while the session wallet resolves — the logged-out fallback must
    // never render for an authenticated user
    if (!pending) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, pending]);

  // enable ring transitions only after the arrival position has painted
  useEffect(() => {
    const t = window.setTimeout(() => setSnap(false), 80);
    return () => window.clearTimeout(t);
  }, []);

  // once the sealed card has revealed, the registry has it — drop the draft
  // when leaving so revisits use the fetched card instead
  useEffect(() => {
    return () => {
      if (getDraft()?.status === "minted") clearDraft();
    };
  }, []);

  // scale the fixed-size card stage down on short viewports
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      // height cap uses the front card's PROJECTED height (500 × 1.224 at
      // radius 275 ≈ 612, plus margin); size ratio 1:1 with the final mock
      setScale(Math.min(1, r.height / 620, r.width / 402));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // AUTHENTICATING ticker: a fast ~1s verification beat to 100%; if the real
  // mint is still confirming after that, the veil switches to MINTING…
  useEffect(() => {
    if (!draft || revealed || draft.status === "error") return;
    const iv = window.setInterval(() => {
      setPct((p) => Math.min(100, p + 7));
    }, 70);
    return () => window.clearInterval(iv);
  }, [draft, revealed]);

  // reveal only when the beat is done AND the chain mint actually confirmed
  useEffect(() => {
    if (pct >= 100 && draft?.status === "minted" && !revealed) {
      setRevealed(true);
    }
  }, [pct, draft, revealed]);
  // …then auto-flip to the spec side (separate effect — a combined one
  // cancels its own timeout when `revealed` flips its dependency)
  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => {
      setFlipped(true);
      setFlipDir("in");
    }, 500);
    return () => window.clearTimeout(t);
  }, [revealed]);

  const vms = useMemo<CardVM[]>(() => {
    const list: CardVM[] = [];
    if (draft) {
      const sealed = !revealed;
      list.push({
        key: "draft",
        name: draft.name,
        img: draft.photo,
        num:
          !sealed && draft.assetId
            ? `#${draft.assetId.slice(-4).toUpperCase()}`
            : "PENDING",
        rarity: sealed ? "SEALING" : "RARE",
        date: dateFor(draft.caughtAt ?? new Date().toISOString()),
        place: placeFor(draft.lat, draft.lon, draft.assetId ?? draft.name),
        stats: statsFor(sealed ? null : draft.assetId),
        sealing: sealed,
        mintFailed: draft.status === "error",
      });
    }
    const sorted = [...(cards ?? [])].sort((a, b) =>
      (b.time ?? "").localeCompare(a.time ?? ""),
    );
    for (const c of sorted) {
      if (draft?.assetId && c.assetId === draft.assetId) continue;
      list.push({
        key: c.assetId,
        name: stripPrefix(c.name),
        img: c.photo,
        num: `#${c.assetId.slice(-4).toUpperCase()}`,
        rarity: c.rarity ?? "RARE",
        date: dateFor(c.time),
        place: placeFor(c.lat, c.lon, c.assetId),
        stats: statsFor(c.assetId),
        sealing: false,
        mintFailed: false,
      });
    }
    return list;
  }, [draft, cards, revealed]);

  // True rotating ring per the carousel spec: the pivot rotates by
  // -turn × (360/S); mounts sit at fixed ring angles with a 0.42
  // counter-rotation by signed distance. `turn` is cumulative (never
  // wrapped — wrapping reverses animation direction). When the collection
  // exceeds 5 cards the ring is virtualized to 5 mounts (the reference
  // geometry) and cards rotate through mounts while hidden.
  const N = vms.length;
  const active = N > 0 ? ((turn % N) + N) % N : 0;
  const S = Math.min(N, 5);
  const step = S > 0 ? 360 / S : 360;
  const sFront = S > 0 ? ((turn % S) + S) % S : 0;
  const halfS = Math.floor(S / 2);
  // short settle only — the drag itself follows the finger with no animation
  const ringMove = "transform .28s cubic-bezier(.25,.5,.3,1)";

  // signed circular distance of slot s from a (possibly fractional) turn
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
    setFlipDir(null); // rotating away resets the wrapper without a flip-out
  }
  const goRef = useRef(go);
  goRef.current = go;

  // ArrowLeft / ArrowRight navigate the ring
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
    if (vm.sealing) {
      if (vm.mintFailed) {
        setPct(0);
        retryMint();
      }
      return; // sealing cards don't flip
    }
    // ignore taps mid-flip — restarting the keyframes would jump-cut
    const now = performance.now();
    if (now - lastFlipRef.current < 900) return;
    lastFlipRef.current = now;
    setFlipDir(flipped ? "out" : "in");
    setFlipped((f) => !f);
  }

  // direct-manipulation drag: the ring follows the finger 1:1 (imperative
  // transform writes, zero animation), then settles to the nearest card
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
      // a real drag starts — close an open spec side without animation
      if (flipped) {
        setFlipped(false);
        setFlipDir(null);
      }
    }
    if (!movedRef.current) return; // taps shouldn't nudge the ring
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
    // re-enable the short settle, then let React commit the final pose
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
      // spring back to the current card
      requestAnimationFrame(() => {
        if (pivot) pivot.style.transform = pivotT(turn);
        eachMount((el, s) => {
          el.style.transform = mountT(s, turn);
        });
      });
    }
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden text-foreground"
      style={{
        background:
          "linear-gradient(180deg, #0A0A0F 0%, #0A0A0F 55%, #101015 100%)",
        paddingTop: "max(env(safe-area-inset-top), 24px)",
      }}
    >
      {/* header */}
      <div className="relative z-[12] flex items-center justify-between px-5 pt-[6px]">
        <div className="flex flex-col gap-[2px]">
          <span className="font-mono text-[13px] font-semibold leading-none tracking-[.26em]">
            RBOLA
          </span>
        </div>
        {sol !== null && (
          <div
            className="flex h-[30px] items-center gap-[6px] rounded-[15px] px-[11px]"
            style={{
              background: "rgba(255,255,255,.045)",
              border: ".5px solid rgba(233,231,226,.16)",
            }}
          >
            <span
              className="h-[6px] w-[6px] rotate-45 rounded-[1px]"
              style={{ background: "rgba(242,241,238,.55)" }}
              aria-hidden
            />
            <span className="font-mono text-[11.5px] font-medium leading-none">
              {sol.toFixed(2)}
            </span>
            <span className="font-mono text-[9px] font-medium leading-none tracking-[.14em] text-[rgba(242,241,238,.4)]">
              SOL
            </span>
          </div>
        )}
      </div>

      {/* carousel */}
      <div
        ref={stageRef}
        className="relative mt-6 min-h-0 flex-1"
        style={{ touchAction: "pan-y" }}
        onPointerDown={swipeDown}
        onPointerMove={swipeMove}
        onPointerUp={swipeUp}
        onPointerCancel={swipeUp}
      >
        {N === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
            {loadError ? (
              <button onClick={load} className="flex flex-col items-center gap-3">
                <span className="font-mono text-[10px] tracking-[.2em] text-[rgba(242,241,238,.4)]">
                  GARAGE UNAVAILABLE
                </span>
                <span className="font-mono text-[9px] tracking-[.2em] text-[rgba(242,241,238,.25)]">
                  TAP TO RETRY
                </span>
              </button>
            ) : cards === null ? (
              <span className="animate-pulse font-mono text-[10px] tracking-[.24em] text-[rgba(242,241,238,.4)]">
                OPENING GARAGE
              </span>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span className="font-mono text-[10px] tracking-[.2em] text-[rgba(242,241,238,.4)]">
                  YOUR GARAGE IS EMPTY
                </span>
                <a
                  href="/catch"
                  className="font-mono text-[9px] tracking-[.2em] text-accent"
                >
                  CATCH YOUR FIRST CAR
                </a>
              </div>
            )}
          </div>
        )}

        {/* responsive scale lives OUTSIDE the 3D context — WebKit (every
            iOS browser) drops perspective when an intermediate layer inside
            the 3D chain carries its own transform */}
        <div className="absolute inset-0" style={{ transform: `scale(${scale})` }}>
        <div className="keep-3d-alive absolute inset-0" style={{ perspective: "1500px" }}>
          <div
            ref={pivotRef}
            className="absolute left-1/2 top-1/2 h-0 w-0"
            style={{
              transformStyle: "preserve-3d",
              // hint layer promotion at first paint — without it, WebKit can
              // compose the ring flat until the first transform change
              willChange: "transform",
              transition: snap ? "none" : ringMove,
              transform: pivotT(turn),
            }}
          >
            {Array.from({ length: S }, (_, s) => {
              const sd = ((s - sFront + halfS + S) % S) - halfS;
              const cardIdx = (((active + sd) % N) + N) % N;
              const vm = vms[cardIdx];
              const vis = Math.abs(sd) <= 1;
              const isActive = sd === 0;
              const showBack = isActive && flipped && !vm.sealing;
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
                    // transform ONLY — keeps the 3D layer promoted at rest
                    // (listing opacity here is a grouping hint that flattens)
                    willChange: "transform",
                    transform: mountT(s, turn),
                    transition: snap
                      ? "none"
                      : `opacity .45s ease, ${ringMove}`,
                    // rear cards stay visible — their slivers fill the gaps
                    // between the front card and the neighbours (founder ask)
                    opacity: 1,
                    pointerEvents: vis ? "auto" : "none",
                  }}
                >
                  {/* zoom layer (arcs forward) wrapping the rotation layer
                      (one continuous curve — keeps the flip pause-free) */}
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
                    {/* front — same WebKit culling workaround as the back:
                        hide at the flip's 90° midpoint */}
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

                      {/* photo */}
                      <div
                        className="absolute left-0 right-0 top-0 h-[376px] overflow-hidden rounded-t-[22px]"
                        style={{
                          transition: "filter .4s ease",
                          filter: vm.sealing
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

                      {/* sealing veil + label */}
                      <div
                        className="pointer-events-none absolute inset-0 z-[6] rounded-[22px]"
                        style={{
                          transition: "opacity .4s ease",
                          opacity: vm.sealing ? 0.88 : 0,
                          background:
                            "linear-gradient(180deg, rgba(7,7,10,.72), rgba(7,7,10,.86))",
                        }}
                      />
                      <div
                        className="pointer-events-none absolute left-0 right-0 top-1/2 z-[7] flex -translate-y-1/2 flex-col items-center gap-[14px]"
                        style={{
                          transition: "opacity .4s ease",
                          opacity: vm.sealing ? 1 : 0,
                        }}
                      >
                        {!vm.mintFailed && (
                          <span
                            className="h-7 w-7 animate-spin rounded-full"
                            style={{
                              border: "2px solid rgba(242,241,238,.12)",
                              borderTopColor: "#C9B37E",
                            }}
                            aria-hidden
                          />
                        )}
                        <span className="font-mono text-[9.5px] font-medium leading-none tracking-[.24em] text-[rgba(242,241,238,.72)]">
                          {vm.mintFailed
                            ? "MINT FAILED · TAP TO RETRY"
                            : pct >= 100
                              ? "MINTING…"
                              : `AUTHENTICATING · ${pct}%`}
                        </span>
                      </div>

                      {/* top row: rarity + coin */}
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

                      {/* bottom info */}
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
                            {vm.sealing ? "LOCKED" : "TAP FOR SPECS"}
                          </span>
                        </div>
                      </div>

                      {/* inactive dim — rear cards sit deeper in shadow */}
                      <div
                        className="pointer-events-none absolute inset-0 z-[8] rounded-[22px] bg-[#07070A]"
                        style={{
                          transition: "opacity .6s ease",
                          opacity: isActive ? 0 : vis ? 0.38 : 1,
                        }}
                      />
                    </div>

                    {/* back (spec side) — WebKit's backface culling fails in
                        nested 3D (the back paints over the front), so gate
                        visibility on flip state, swapping at the flip's 90°
                        midpoint (.4s of the .8s flip) */}
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
                          <div key={s.label} className="flex flex-col gap-[9px]">
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
                        <a
                          href={
                            vm.sealing || vm.key === "draft"
                              ? undefined
                              : `/race?car=${vm.key}`
                          }
                          // the card container's tap handler flips the card —
                          // don't let the RACE tap bubble into it
                          onClick={(e) => e.stopPropagation()}
                          className="mt-[14px] flex h-[46px] items-center justify-center rounded-[13px] bg-[#15151C] hover:bg-[#1B1B23]"
                          style={{
                            border: ".5px solid rgba(201,179,126,.62)",
                            boxShadow:
                              "0 8px 22px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
                          }}
                        >
                          <span className="font-mono text-[11px] font-semibold leading-none tracking-[.3em]">
                            RACE
                          </span>
                        </a>
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

      {/* prev/next arrows (dots don't scale to 20+ cars) */}
      {N > 1 && (
        <div
          className="flex flex-none items-center justify-center gap-[18px] pt-3"
          style={{
            paddingBottom:
              "calc(max(env(safe-area-inset-bottom), 16px) + 82px)",
          }}
        >
          <button
            onClick={() => go(-1)}
            aria-label="Previous card"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[17px] border-[.5px] border-[rgba(201,179,126,.4)] bg-[rgba(201,179,126,.08)] transition-[background-color,border-color] duration-200 ease-out hover:border-[rgba(224,205,156,.7)] hover:bg-[rgba(201,179,126,.16)] active:scale-[.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <span
              className="ml-[3px] block h-[7px] w-[7px] rotate-45"
              style={{
                borderLeft: "1.3px solid #C9B37E",
                borderBottom: "1.3px solid #C9B37E",
              }}
              aria-hidden
            />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Next card"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[17px] border-[.5px] border-[rgba(201,179,126,.4)] bg-[rgba(201,179,126,.08)] transition-[background-color,border-color] duration-200 ease-out hover:border-[rgba(224,205,156,.7)] hover:bg-[rgba(201,179,126,.16)] active:scale-[.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <span
              className="mr-[3px] block h-[7px] w-[7px] rotate-45"
              style={{
                borderRight: "1.3px solid #C9B37E",
                borderTop: "1.3px solid #C9B37E",
              }}
              aria-hidden
            />
          </button>
        </div>
      )}
    </div>
  );
}
