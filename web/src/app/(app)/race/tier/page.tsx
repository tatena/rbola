"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOwner } from "@/lib/useOwner";
import RaceProgress from "../RaceProgress";

// Race flow step 2 — SELECT TIER (design: Claude Design "RBOLA Phone.dc.html"
// tier step / "RBOLA Tier Select v7", the H-gate shifter).
// Tiers = rarity rooms (locked 2026-10-08, tasks/race-logic.md): gears 1–5 are
// COMMON · SCARCE · RARE · EPIC · LEGENDARY, R = free practice.
// Eligibility is real: counts come from the garage (provisional cards don't
// count toward paid rooms — the race gate).

type ApiCard = {
  assetId: string;
  name: string;
  photo: string | null;
  rarity: string | null;
  provisional?: boolean;
};

// plate geometry (378×400 design units)
const COLS = [69, 189, 309];
const TY = 110;
const NY = 210;
const BY = 310;

type GateKey = 0 | 1 | 2 | 3 | 4 | "R";
type Gate = {
  key: GateKey;
  name: string;
  stake: string;
  col: number;
  row: "top" | "bot";
};

const GATES: Gate[] = [
  { key: 0, name: "COMMON", stake: "0.01 SOL", col: 0, row: "top" },
  { key: 1, name: "SCARCE", stake: "0.02 SOL", col: 0, row: "bot" },
  { key: 2, name: "RARE", stake: "0.05 SOL", col: 1, row: "top" },
  { key: 3, name: "EPIC", stake: "0.10 SOL", col: 1, row: "bot" },
  { key: 4, name: "LEGENDARY", stake: "0.25 SOL", col: 2, row: "top" },
  { key: "R", name: "R", stake: "FREE PRACTICE", col: 2, row: "bot" },
];

const ROOM_NAMES = ["COMMON", "SCARCE", "RARE", "EPIC", "LEGENDARY"];

const gateY = (g: Gate) => (g.row === "top" ? TY : BY);
const gateAt = (x: number, y: number): Gate | null => {
  const col = COLS.indexOf(x);
  if (col < 0 || Math.abs(y - NY) < 1) return null;
  const row = y < NY ? "top" : "bot";
  return GATES.find((g) => g.col === col && g.row === row) ?? null;
};
const nearestCol = (px: number) =>
  COLS.reduce((a, c) => (Math.abs(c - px) < Math.abs(a - px) ? c : a), COLS[0]);

export default function RaceTierSelect() {
  const router = useRouter();
  const [sol, setSol] = useState<number | null>(null);
  const [cards, setCards] = useState<ApiCard[] | null>(null);
  const [raceProvisional, setRaceProvisional] = useState(false);

  // shifter state
  const [pos, setPos] = useState({ x: 189, y: NY });
  const [seat, setSeat] = useState<GateKey | null>(null);
  const [dragging, setDragging] = useState(false);
  const [trailStart, setTrailStart] = useState({ x: 189, y: NY });
  const [trailOn, setTrailOn] = useState(false);
  const plateRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<{ ox: number; oy: number } | null>(null);

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

  // real room eligibility: provisional cards don't count toward paid rooms,
  // except where the server lets them race (devnet flag)
  const roomCards = (room: number) =>
    (cards ?? []).filter(
      (c) => (c.rarity ?? "").toUpperCase() === ROOM_NAMES[room],
    );
  const eligible = (room: number) =>
    roomCards(room).filter((c) => !c.provisional || raceProvisional);
  const counts = ROOM_NAMES.map((_, i) => eligible(i).length);
  // every gate is seatable — an empty room just reads "NO CARS" and
  // CONTINUE stays dead (founder call 2026-10-08)

  // plate scale: design is 378 wide; capped at 340 so the CTA stays on
  // screen inside browser chrome (pre-PWA), and fit to narrow phones
  const [plateW, setPlateW] = useState(340);
  useEffect(() => {
    const update = () => setPlateW(Math.min(330, window.innerWidth - 24));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const k = plateW / 378; // scale factor for pointer math

  const toPlate = (e: React.PointerEvent) => {
    const r = plateRef.current!.getBoundingClientRect();
    return { px: (e.clientX - r.left) / k, py: (e.clientY - r.top) / k };
  };

  const onDown = (e: React.PointerEvent) => {
    const { px, py } = toPlate(e);
    if (Math.hypot(px - pos.x, py - pos.y) > 52) return;
    grabRef.current = { ox: px - pos.x, oy: py - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    setTrailOn(true);
    setTrailStart({ x: pos.x, y: pos.y });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging || !grabRef.current) return;
    const { px: rawX, py: rawY } = toPlate(e);
    const px = rawX - grabRef.current.ox;
    const py = rawY - grabRef.current.oy;
    const { x: cx, y: cy } = pos;
    const clampX = (v: number) => Math.max(COLS[0], Math.min(COLS[2], v));
    const clampY = (v: number) => Math.max(TY, Math.min(BY, v));
    const col = nearestCol(px);
    // generous capture zones so diagonal finger paths don't fight the gate
    const nearRail = Math.abs(py - NY) < 22;
    const nearCol = Math.abs(px - col) < 26;
    let tx: number, ty: number;
    if (nearRail) {
      tx = clampX(px);
      ty = NY;
    } else if (nearCol) {
      tx = col;
      ty = clampY(py);
    } else {
      // diagonal no-man's land: project onto whichever rail is closer
      if (Math.abs(px - col) <= Math.abs(py - NY)) {
        tx = col;
        ty = clampY(py);
      } else {
        tx = clampX(px);
        ty = NY;
      }
    }
    // H-gate integrity: column changes only through the neutral rail —
    // while deep in a slot, x eases to that slot's column center
    if (Math.abs(cy - NY) > 22 && Math.abs(tx - nearestCol(cx)) > 1) {
      tx = nearestCol(cx);
      ty = clampY(py);
    }
    // soft follow — the stick eases toward the finger instead of snapping,
    // which rounds the corners of the gate
    setPos({ x: cx + (tx - cx) * 0.6, y: cy + (ty - cy) * 0.6 });
  };

  const onUp = () => {
    if (!dragging) return;
    setDragging(false);
    setTrailOn(false);
    grabRef.current = null;
    // soft-follow means pos is near, not exactly on, a column — snap to nearest
    const g = gateAt(nearestCol(pos.x), pos.y);
    if (g && Math.abs(pos.y - NY) > 52) {
      setPos({ x: COLS[g.col], y: gateY(g) });
      setSeat(g.key);
      sessionStorage.setItem("rbola.race.tier", String(g.key));
    } else {
      setPos({ x: 189, y: NY });
      setSeat(null);
      sessionStorage.removeItem("rbola.race.tier");
    }
  };

  const ctaDead =
    seat == null || (seat !== "R" && counts[seat as number] === 0);

  // seated room's car becomes the backdrop behind the plate (no text) —
  // the last photo is kept so the fade-out shows the same image
  const seatPhoto =
    seat == null
      ? null
      : seat === "R"
        ? ((cards ?? []).find((c) => c.photo)?.photo ?? null)
        : (roomCards(seat as number).find((c) => c.photo)?.photo ?? null);
  const [bgPhoto, setBgPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (seatPhoto) setBgPhoto(seatPhoto);
  }, [seatPhoto]);
  const trailD =
    trailStart.x === pos.x
      ? `M${trailStart.x} ${trailStart.y} L${pos.x} ${pos.y}`
      : `M${trailStart.x} ${trailStart.y} L${trailStart.x} ${NY} L${pos.x} ${NY} L${pos.x} ${pos.y}`;

  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{
        background: "linear-gradient(180deg,#0A0A0F,#101015)",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)",
      }}
    >
      {/* header */}
      <div className="relative flex items-center justify-between px-5 pt-[6px]">
        <button
          onClick={() => router.push("/race")}
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
            SELECT TIER
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

      <RaceProgress step={1} />

      {/* shifter plate — anchored high so CONTINUE stays visible in-browser */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-3">
        {/* seated room's car, dimmed behind the frosted plate */}
        {bgPhoto && (
          <span
            className="pointer-events-none absolute inset-x-0 -top-6 bottom-0 z-0 block overflow-hidden transition-opacity duration-700"
            style={{
              opacity: seat != null && seatPhoto ? 0.28 : 0,
              filter: "saturate(.6) brightness(.55)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={bgPhoto}
              alt=""
              className="h-full w-full object-cover"
            />
            <span
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg,#0A0A0F 0%,rgba(10,10,15,.3) 30%,rgba(10,10,15,.3) 70%,#0A0A0F 100%)",
              }}
            />
          </span>
        )}
        <div
          ref={plateRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="relative z-10 box-border select-none"
          style={{
            width: plateW,
            height: 400 * k,
            borderRadius: 22,
            background: "rgba(13,13,18,.72)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: ".5px solid rgba(233,231,226,.12)",
            touchAction: "none",
            cursor: dragging ? "grabbing" : "grab",
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: 378, height: 400, transform: `scale(${k})` }}
          >
            <svg
              viewBox="0 0 378 420"
              width="378"
              height="420"
              className="pointer-events-none absolute inset-0 block"
            >
              <g
                stroke="rgba(242,241,238,.16)"
                strokeWidth="31"
                strokeLinecap="round"
                fill="none"
              >
                <path d="M69 110 V310 M189 110 V310 M309 110 V310 M69 210 H309" />
              </g>
              <g
                stroke="#040406"
                strokeWidth="29"
                strokeLinecap="round"
                fill="none"
              >
                <path d="M69 110 V310 M189 110 V310 M309 110 V310 M69 210 H309" />
              </g>
              <g
                stroke="rgba(0,0,0,.9)"
                strokeWidth="22"
                strokeLinecap="round"
                fill="none"
              >
                <path d="M69 110 V310 M189 110 V310 M309 110 V310 M69 210 H309" />
              </g>
              <g stroke="rgba(242,241,238,.04)" strokeWidth="1" fill="none">
                <path d="M55 110 V310 M175 110 V310 M295 110 V310 M69 196 H309" />
              </g>
              <path
                d={trailD}
                fill="none"
                stroke="#C9B37E"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  opacity: trailOn ? 0.75 : 0,
                  transition: trailOn ? "none" : "opacity 1.1s ease .25s",
                }}
              />
            </svg>

            {/* gate numerals in the slots */}
            {GATES.map((g) => {
              const on = seat === g.key;
              const near =
                Math.hypot(COLS[g.col] - pos.x, gateY(g) - pos.y) < 26;
              return (
                <span
                  key={`m-${g.key}`}
                  className="pointer-events-none absolute flex h-6 w-6 items-center justify-center font-mono text-[11px]"
                  style={{
                    left: COLS[g.col],
                    top: gateY(g),
                    margin: "-12px 0 0 -12px",
                    color: on ? "#C9B37E" : "rgba(242,241,238,.4)",
                    opacity: near ? 0 : 1,
                    transition: "color .5s ease, opacity .3s ease",
                  }}
                >
                  {g.key === "R" ? "R" : (g.key as number) + 1}
                </span>
              );
            })}

            {/* gate labels + stakes */}
            {GATES.map((g) => {
              const on = seat === g.key;
              return (
                <div
                  key={`g-${g.key}`}
                  className="pointer-events-none absolute flex w-[118px] flex-col items-center gap-2"
                  style={{
                    // clear of the knob: it overhangs the slot ends by ~29px
                    left: COLS[g.col] - 59,
                    top: g.row === "top" ? gateY(g) - 14 - 56 : gateY(g) + 14 + 26,
                  }}
                >
                  <span
                    className="flex whitespace-nowrap font-mono text-[12.5px] font-semibold uppercase tracking-[.2em]"
                    style={{
                      color: on
                        ? "#C9B37E"
                        : g.key === "R"
                          ? "rgba(242,241,238,.3)"
                          : "rgba(242,241,238,.45)",
                      transition: "color .5s ease",
                    }}
                  >
                    <span className="whitespace-pre">{g.name}</span>
                  </span>
                  <span
                    className="whitespace-nowrap pl-[.2em] font-mono text-[8.5px] tracking-[.2em]"
                    style={{
                      color: on ? "rgba(201,179,126,.9)" : "rgba(242,241,238,.3)",
                      transition: "color .5s ease",
                    }}
                  >
                    {g.stake}
                  </span>
                </div>
              );
            })}

            {/* the stick */}
            <div
              className="pointer-events-none absolute left-0 top-0 h-0 w-0"
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                transition: dragging
                  ? "none"
                  : "transform .32s cubic-bezier(.34,1.56,.64,1)",
              }}
            >
              <span
                className="absolute block"
                style={{
                  left: -19,
                  top: -19,
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  background: "#121217",
                  border: ".5px solid rgba(242,241,238,.1)",
                  boxShadow: "inset 0 2px 6px rgba(0,0,0,.9)",
                }}
              />
              <span
                className="absolute block"
                style={{
                  left: -7,
                  top: -7,
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  background: "#2A2A31",
                  border: ".5px solid rgba(242,241,238,.22)",
                  boxShadow: "0 2px 4px rgba(0,0,0,.8)",
                }}
              />
              <span
                className="absolute block"
                style={{
                  left: -23,
                  top: -29,
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  background: "#0C0C11",
                  border: ".5px solid rgba(201,179,126,.9)",
                  boxShadow:
                    "0 14px 22px rgba(0,0,0,.8), inset 0 -3px 8px rgba(0,0,0,.7), inset 0 2px 2px rgba(242,241,238,.08)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/rbola-r-mark.png"
                  alt=""
                  className="pointer-events-none absolute block"
                  style={{
                    left: "50%",
                    top: "50%",
                    width: 34,
                    height: "auto",
                    margin: "-6.5px 0 0 -17px",
                  }}
                />
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* CONTINUE / PRACTICE — dead until a seat with eligible cars (R always ok) */}
      <div className="px-5 pt-3">
        <button
          onClick={() => {
            if (ctaDead) return;
            router.push("/race/car");
          }}
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
            {seat === "R" ? "PRACTICE" : "CONTINUE"}
          </span>
        </button>
      </div>
    </div>
  );
}
