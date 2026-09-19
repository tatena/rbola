"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOwner } from "@/lib/useOwner";

// Race flow — design_handoff_camera_screen prototype, screen 1d.
// Step 0 (SELECT CAR) only for now; terrain/match/race/result come next.

type ApiCard = {
  assetId: string;
  name: string;
  photo: string | null;
  lat: number | null;
  lon: number | null;
  time: string | null;
};

const STAT_LABELS = ["Speed", "Handling", "Luck", "Condition"];

// same deterministic per-card stats as the garage, so HP matches the spec side
function statsFor(seed: string): Record<string, number> {
  const out: Record<string, number> = {};
  STAT_LABELS.forEach((label, i) => {
    let h = 2166136261 ^ (i * 977);
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    out[label.toLowerCase()] = 40 + (Math.abs(h) % 58);
  });
  return out;
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
  lat: number | null,
  lon: number | null,
  seed: string,
): string {
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

// HP per prototype: speed×1.1 + handling + condition×0.7 + luck×0.3
function hpOf(st: Record<string, number>) {
  return Math.round(
    st.speed * 1.1 + st.handling + st.condition * 0.7 + st.luck * 0.3,
  );
}

// terrain reweighting per prototype
function effHp(st: Record<string, number>, terrain: string) {
  return Math.round(
    terrain === "TRACK"
      ? st.speed * 1.6 + st.handling * 0.9 + st.condition * 0.4
      : st.condition * 1.4 + st.handling * 1.2 + st.luck * 0.6,
  );
}

const TERRAINS = [
  {
    key: "OFF-ROAD",
    name: "Off-road",
    note: "CONDITION + HANDLING WEIGHTED",
    img: "/terrain-offroad.png",
  },
  {
    key: "TRACK",
    name: "Track",
    note: "SPEED WEIGHTED",
    img: "/terrain-track.png",
  },
];

export default function RacePage() {
  const router = useRouter();
  const [cards, setCards] = useState<ApiCard[] | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // entered via a garage card's RACE button (?car=) — that car is pre-picked
  // and step 0 becomes opponent selection instead of car selection
  const [carParam, setCarParam] = useState<string | null>(null);
  const [rival, setRival] = useState<string | null>(null);
  const [terrain, setTerrain] = useState<string | null>(null);
  const [step, setStep] = useState(0); // 0 car · 1 terrain · 2 match · 3 result
  const [racing, setRacing] = useState(false);
  const [prog, setProg] = useState(0);
  const [videoDur, setVideoDur] = useState(12.8);
  const [flash, setFlash] = useState(false);
  const [finished, setFinished] = useState(false); // winner reveal overlay
  const timersRef = useRef<number[]>([]);
  const raceVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((t) => window.clearInterval(t));
  }, []);

  // play the race video WITH sound (started from the user's tap, so audio
  // is allowed; falls back to muted if the browser refuses)
  useEffect(() => {
    if (!racing) return;
    const v = raceVideoRef.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [racing]);

  useEffect(() => {
    setCarParam(new URLSearchParams(window.location.search).get("car"));
  }, []);

  // race follows the logged-in wallet, like the garage
  const { owner, pending } = useOwner();
  useEffect(() => {
    if (pending) return;
    fetch(`/api/garage${owner ? `?owner=${owner}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return;
        setCards(j.cards ?? []);
        setSol(j.sol ?? null);
      })
      .catch(() => {});
  }, [owner, pending]);

  useEffect(() => {
    if (carParam && (cards ?? []).some((c) => c.assetId === carParam)) {
      setPicked(carParam);
    }
  }, [carParam, cards]);

  const owned = (cards ?? [])
    .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""))
    .map((c) => {
      const st = statsFor(c.assetId);
      return {
        assetId: c.assetId,
        name: stripPrefix(c.name),
        img: c.photo,
        meta: `LEVEL 1 · ${placeFor(c.lat, c.lon, c.assetId)}`,
        st,
        hp: hpOf(st),
      };
    });

  const loading = cards === null;
  const pickedCar = owned.find((c) => c.assetId === picked) ?? null;
  const fromGarage = carParam !== null && picked === carParam;
  const stepLabels = [
    fromGarage ? "SELECT OPPONENT" : "SELECT CAR",
    "SELECT TERRAIN",
    "CONFIRM MATCH",
    "RESULT",
  ];
  // opponent pool = the same real card NFTs (demo); deterministic auto-pick
  // when the player didn't choose one (direct nav to /race)
  const rivalPool = owned.filter((c) => c.assetId !== picked);
  const autoRival =
    pickedCar && rivalPool.length
      ? rivalPool[
          Math.abs(
            [...pickedCar.assetId].reduce(
              (h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619),
              2166136261,
            ),
          ) % rivalPool.length
        ]
      : null;
  const rivalCar =
    (rival && owned.find((c) => c.assetId === rival)) || autoRival;
  const ready =
    step === 0
      ? fromGarage
        ? rival !== null
        : picked !== null
      : terrain !== null;
  const yourHp =
    pickedCar && terrain ? effHp(pickedCar.st, terrain) : 0;
  // rival HP seeded just below yours — close race, but you always win
  const oppHp = pickedCar
    ? Math.max(
        1,
        (yourHp || hpOf(pickedCar.st)) -
          (3 + (Math.abs(pickedCar.assetId.charCodeAt(3) ?? 0) % 9)),
      )
    : 0;

  function startRace() {
    // progress is driven by the video's own playback (onTimeUpdate below),
    // so the race lasts exactly as long as the full video
    setRacing(true);
    setProg(0);
  }

  function primary() {
    if (racing || flash) return;
    if (step < 3 && !ready) return;
    // gold confirmation flash, then advance
    setFlash(true);
    window.setTimeout(() => {
      setFlash(false);
      if (step === 3) {
        // RACE AGAIN — keep the car, rechoose opponent + terrain
        setRival(null);
        setTerrain(null);
        setProg(0);
        setStep(0);
      } else if (step < 2) {
        setStep(step + 1);
      } else {
        startRace();
      }
    }, 300);
  }
  function back() {
    if (racing) return;
    if (step > 0) setStep(step - 1);
  }

  // live race derivations (prototype raceVals)
  const win = true; // demo mode: the founder always wins
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const swing = Math.sin((prog / 100) * Math.PI * 2.6) * (1 - prog / 100);
  const lead = (win ? 1 : -1) * (0.22 + 0.78 * (prog / 100)) + swing;
  const isTrack = terrain === "TRACK";
  const roadDur = (0.62 - 0.36 * Math.min(1, prog / 100)).toFixed(2) + "s";
  const shakeDur = (0.24 - 0.1 * Math.min(1, prog / 100)).toFixed(2) + "s";
  const joltDur = (0.34 - 0.16 * Math.min(1, prog / 100)).toFixed(2) + "s";
  const telemetry = [
    {
      label: "SPEED",
      value:
        Math.round(
          (isTrack ? 68 + prog * 1.62 : 44 + prog * 0.96) +
            Math.sin(prog / 5) * (isTrack ? 5 : 9),
        ) + " KM/H",
      color: "#F2F1EE",
    },
    {
      label: "GAP",
      value: (lead > 0 ? "+" : "−") + Math.abs(lead * 1.4).toFixed(2) + "s",
      color: lead > 0 ? "#C9B37E" : "rgba(242,241,238,.7)",
    },
    { label: "GRIP", value: isTrack ? "92%" : "71%", color: "#F2F1EE" },
  ];
  const carsOnTrack = [
    {
      tag: "YOU",
      left: "calc(31% - 23px)",
      bottom: Math.round(66 + clamp(lead) * 30),
      scale: 0.92 + clamp(lead) * 0.1,
      bobDur: isTrack ? "1.6s" : ".42s",
      chipBd: "rgba(201,179,126,.5)",
      chipColor: "#C9B37E",
      fill: "linear-gradient(180deg, rgba(214,196,150,.95), rgba(150,128,82,.95))",
    },
    {
      tag: "RIVAL",
      left: "calc(69% - 23px)",
      bottom: Math.round(66 - clamp(lead) * 30),
      scale: 0.92 - clamp(lead) * 0.1,
      bobDur: isTrack ? "1.8s" : ".5s",
      chipBd: "rgba(233,231,226,.28)",
      chipColor: "rgba(242,241,238,.75)",
      fill: "linear-gradient(180deg, rgba(226,226,230,.9), rgba(140,148,158,.9))",
    },
  ];
  const maxHp = Math.max(yourHp, oppHp) || 1;

  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden text-foreground"
      style={{
        background: "linear-gradient(180deg,#0A0A0F,#101015)",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 60px)",
      }}
    >
      {/* header — RBOLA, matching the garage; back chevron animates in
          on steps past the first (slot is always reserved — no layout shift) */}
      <div className="flex items-center justify-between px-5 pt-[6px]">
        {/* RBOLA hugs the left edge on step 0; on later steps it glides
            right while the back chevron fades in at the edge */}
        <div className="relative flex items-center">
          <button
            onClick={back}
            aria-label="Previous step"
            aria-hidden={step === 0 || racing}
            tabIndex={step === 0 || racing ? -1 : 0}
            className="absolute left-0 flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            style={{
              border: ".5px solid rgba(233,231,226,.16)",
              transition:
                "opacity .3s cubic-bezier(0,0,.2,1), transform .3s cubic-bezier(0,0,.2,1)",
              opacity: step > 0 && step < 3 && !racing ? 1 : 0,
              transform:
                step > 0 && step < 3 && !racing ? "none" : "translateX(-8px) scale(.7)",
              pointerEvents: step > 0 && step < 3 && !racing ? "auto" : "none",
            }}
          >
            <span
              className="block h-[9px] w-[9px] rotate-45"
              style={{
                borderLeft: "1px solid rgba(242,241,238,.7)",
                borderBottom: "1px solid rgba(242,241,238,.7)",
              }}
              aria-hidden
            />
          </button>
          <span
            className="font-mono text-[13px] font-semibold leading-none tracking-[.26em]"
            style={{
              transition: "transform .3s cubic-bezier(0,0,.2,1)",
              transform:
                step > 0 && step < 3 && !racing ? "translateX(44px)" : "translateX(0)",
            }}
          >
            RBOLA
          </span>
        </div>
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
          <span className="inline-block min-w-[28px] text-right font-mono text-[11.5px] font-medium leading-none">
            {sol === null ? "—" : sol.toFixed(2)}
          </span>
          <span className="font-mono text-[9px] font-medium leading-none tracking-[.14em] text-[rgba(242,241,238,.4)]">
            SOL
          </span>
        </div>
      </div>

      {/* step progress */}
      <div className="flex gap-[5px] px-5 pt-4">
        {stepLabels.map((label, n) => (
          <span
            key={label}
            className="relative h-[2px] flex-1 overflow-hidden rounded-[2px] bg-[rgba(242,241,238,.13)]"
          >
            <span
              className="absolute left-0 top-0 h-full rounded-[2px] bg-accent"
              style={{
                transition: "width .6s cubic-bezier(.3,0,.2,1)",
                width: n <= (racing ? 2 : step) ? "100%" : "0%",
              }}
            />
          </span>
        ))}
      </div>

      {/* pick car */}
      {step === 0 && (
      <div className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-5 pb-[250px] pt-[22px]">
        {loading &&
          Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-[13px] rounded-[15px] p-[13px]"
              style={{
                background: "rgba(255,255,255,.035)",
                border: ".5px solid rgba(233,231,226,.11)",
              }}
            >
              <span
                className="block aspect-[270/376] w-[66px] flex-none rounded-[9px] bg-[rgba(255,255,255,.06)]"
                style={{ border: ".5px solid rgba(233,231,226,.13)" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block h-[16px] w-[150px] rounded-[4px] bg-[rgba(255,255,255,.08)]" />
              </span>
              <span className="flex flex-none flex-col items-end gap-1">
                <span className="h-[17px] w-[34px] rounded-[4px] bg-[rgba(255,255,255,.08)]" />
                <span className="h-[8px] w-[16px] rounded-[3px] bg-[rgba(255,255,255,.06)]" />
              </span>
            </div>
          ))}

        {!loading && owned.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="font-mono text-[10px] tracking-[.2em] text-[rgba(242,241,238,.4)]">
              NO CARS TO RACE
            </span>
            <a
              href="/catch"
              className="font-mono text-[9px] tracking-[.2em] text-accent"
            >
              CATCH YOUR FIRST CAR
            </a>
          </div>
        )}

        {(fromGarage ? rivalPool : owned).map((c) => {
          const sel = (fromGarage ? rival : picked) === c.assetId;
          return (
            <button
              key={c.assetId}
              onClick={() =>
                fromGarage ? setRival(c.assetId) : setPicked(c.assetId)
              }
              className="flex items-center gap-[13px] rounded-[15px] p-[13px] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              style={{
                transition: "background .25s ease, border-color .25s ease",
                background: sel ? "rgba(201,179,126,.08)" : "rgba(255,255,255,.035)",
                border: `.5px solid ${
                  sel ? "rgba(201,179,126,.4)" : "rgba(233,231,226,.11)"
                }`,
              }}
            >
              <span
                className="block aspect-[270/376] w-[66px] flex-none overflow-hidden rounded-[9px] bg-[#15151A]"
                style={{ border: ".5px solid rgba(233,231,226,.13)" }}
              >
                {c.img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.img}
                    alt={c.name}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14.5px] leading-[1.1]">
                {c.name}
              </span>
              <span className="flex flex-none flex-col items-end gap-1">
                <span
                  className="font-mono text-[17px] font-medium leading-none"
                  style={{ color: sel ? "#C9B37E" : "#F2F1EE" }}
                >
                  {c.hp}
                </span>
                <span className="font-mono text-[8px] font-medium leading-none tracking-[.2em] text-[rgba(242,241,238,.32)]">
                  HP
                </span>
              </span>
            </button>
          );
        })}
      </div>

      )}

      {/* pick terrain */}
      {step === 1 && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-[250px] pt-[22px]">
          {TERRAINS.map((t) => {
            const sel = terrain === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTerrain(t.key)}
                className="relative h-[172px] flex-none overflow-hidden rounded-[16px] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                style={{
                  transition: "border-color .25s ease, box-shadow .25s ease",
                  // photos swallow a .5px hairline — selection needs a
                  // clearly visible gold border
                  border: `1.5px solid ${
                    sel ? "#C9B37E" : "rgba(233,231,226,.14)"
                  }`,
                  boxShadow: sel
                    ? "0 0 0 1px rgba(201,179,126,.35)"
                    : "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.img}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  aria-hidden
                />
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(7,7,10,.15), rgba(7,7,10,.88))",
                  }}
                  aria-hidden
                />
                <span className="absolute bottom-[14px] left-[15px] right-[15px] flex items-end">
                  <span className="text-[17px] leading-[1.1] text-foreground-bright">
                    {t.name}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* confirm match */}
      {step === 2 && !racing && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-[250px] pt-[26px]">
          <div className="flex items-stretch gap-3">
            <div
              className="flex flex-1 flex-col gap-[10px] rounded-[16px] px-[14px] py-[15px]"
              style={{
                background: "rgba(201,179,126,.07)",
                border: ".5px solid rgba(201,179,126,.32)",
              }}
            >
              <span className="font-mono text-[8px] font-medium leading-none tracking-[.2em] text-[rgba(201,179,126,.85)]">
                YOU
              </span>
              <span className="block aspect-[270/376] w-full overflow-hidden rounded-[9px] bg-[#15151A]">
                {pickedCar?.img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pickedCar.img}
                    alt={pickedCar.name}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="text-[13px] leading-[1.15]">
                {pickedCar?.name ?? "—"}
              </span>
              <span className="flex items-baseline gap-[6px]">
                <span className="font-mono text-[20px] font-medium leading-none">
                  {yourHp}
                </span>
                <span className="font-mono text-[8px] font-medium leading-none tracking-[.2em] text-[rgba(242,241,238,.34)]">
                  HP
                </span>
              </span>
            </div>
            <div
              className="flex flex-1 flex-col gap-[10px] rounded-[16px] px-[14px] py-[15px]"
              style={{
                background: "rgba(255,255,255,.035)",
                border: ".5px solid rgba(233,231,226,.11)",
              }}
            >
              <span className="font-mono text-[8px] font-medium leading-none tracking-[.2em] text-[rgba(242,241,238,.4)]">
                RIVAL · @kv_213
              </span>
              <span
                className="block aspect-[270/376] w-full overflow-hidden rounded-[9px] bg-[#15151A]"
                style={
                  rivalCar?.img
                    ? undefined
                    : {
                        background:
                          "radial-gradient(120% 100% at 30% 100%, rgba(90,96,106,.5), rgba(0,0,0,0) 60%), linear-gradient(160deg, #1c1e24, #101014)",
                      }
                }
              >
                {rivalCar?.img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={rivalCar.img}
                    alt={rivalCar.name}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="text-[13px] leading-[1.15] text-[rgba(242,241,238,.86)]">
                {rivalCar?.name ?? "AMG GT Black Series"}
              </span>
              <span className="flex items-baseline gap-[6px]">
                <span className="font-mono text-[20px] font-medium leading-none">
                  {oppHp}
                </span>
                <span className="font-mono text-[8px] font-medium leading-none tracking-[.2em] text-[rgba(242,241,238,.34)]">
                  HP
                </span>
              </span>
            </div>
          </div>

          <div className="mt-[18px] flex flex-col">
            {[
              ["TERRAIN", terrain === "TRACK" ? "Track" : "Off-road", "rgba(242,241,238,.84)", false],
              ["ENTRY", "0.05 SOL", "rgba(242,241,238,.84)", true],
              ["WINNER TAKES", "0.09 SOL", "#C9B37E", true],
            ].map(([label, value, color, mono], i, arr) => (
              <div
                key={label as string}
                className="flex items-center justify-between py-3"
                style={{
                  borderTop: ".5px solid rgba(233,231,226,.1)",
                  borderBottom:
                    i === arr.length - 1
                      ? ".5px solid rgba(233,231,226,.1)"
                      : undefined,
                }}
              >
                <span className="font-mono text-[10.5px] leading-none tracking-[.14em] text-[rgba(242,241,238,.4)]">
                  {label}
                </span>
                <span
                  className={`${mono ? "font-mono font-medium" : ""} text-[12px] leading-none`}
                  style={{ color: color as string }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
          <span className="mt-[14px] font-mono text-[9.5px] leading-[1.5] tracking-[.1em] text-[rgba(242,241,238,.3)]">
            HIGHEST EFFECTIVE HP ON THIS TERRAIN WINS
          </span>
        </div>
      )}

      {/* live race */}
      {racing && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[120px] pt-4">
          <div className="flex items-center justify-between px-5">
            <span className="flex flex-col gap-1">
              <span className="font-mono text-[8.5px] font-medium leading-none tracking-[.22em] text-[rgba(242,241,238,.34)]">
                {isTrack ? "TRACK" : "OFF-ROAD"} · SECTOR{" "}
                {Math.min(3, Math.floor(prog / 34) + 1)}/3
              </span>
              <span className="font-mono text-[26px] leading-none tracking-[-.01em] text-foreground-bright">
                {((prog / 100) * videoDur).toFixed(1)}s
              </span>
            </span>
            <span className="flex flex-col items-end gap-[6px]">
              <span
                className="flex h-7 items-center gap-[7px] rounded-[14px] px-3"
                style={{
                  background: "rgba(201,179,126,.1)",
                  border: ".5px solid rgba(201,179,126,.4)",
                }}
              >
                <span className="h-[5px] w-[5px] rounded-[3px] bg-accent" />
                <span className="font-mono text-[10px] font-semibold leading-none tracking-[.2em] text-accent">
                  {lead > 0 ? "P1" : "P2"} / 2
                </span>
              </span>
              <span
                className="font-mono text-[8px] font-medium leading-none tracking-[.2em]"
                style={{
                  color: lead > 0 ? "#C9B37E" : "rgba(242,241,238,.7)",
                }}
              >
                {lead > 0 ? "YOU LEAD" : "RIVAL LEADS"}
              </span>
            </span>
          </div>

          {/* scene — founder's race video, original file, with sound */}
          <div className="relative mt-4 h-[286px] flex-none overflow-hidden">
            <video
              ref={raceVideoRef}
              src="/race-video-new.mp4"
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) {
                  setVideoDur(v.duration);
                  setProg(Math.min(100, (v.currentTime / v.duration) * 100));
                }
              }}
              onEnded={() => {
                setProg(100);
                setFinished(true); // winner card stays open until dismissed
              }}
            />
            {/* vignette, finish flash, countdown */}
            <span
              className="pointer-events-none absolute inset-0"
              style={{ boxShadow: "inset 0 0 90px rgba(0,0,0,.85)" }}
            />
          </div>

          {/* telemetry + progress */}
          <div className="flex flex-col gap-4 px-5 pt-[18px]">
            <div className="grid grid-cols-3 gap-[10px]">
              {telemetry.map((m) => (
                <div
                  key={m.label}
                  className="flex flex-col gap-[6px] rounded-[12px] px-3 py-[11px]"
                  style={{
                    background: "rgba(255,255,255,.035)",
                    border: ".5px solid rgba(233,231,226,.1)",
                  }}
                >
                  <span className="font-mono text-[7.5px] font-medium leading-none tracking-[.2em] text-[rgba(242,241,238,.34)]">
                    {m.label}
                  </span>
                  <span
                    className="font-mono text-[15px] font-medium leading-none"
                    style={{ color: m.color }}
                  >
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-[9px]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8.5px] font-medium leading-none tracking-[.22em] text-[rgba(242,241,238,.34)]">
                  {prog < 45 ? "LAUNCH" : prog < 85 ? "MID SECTOR" : "FINAL STRAIGHT"}
                </span>
                <span className="font-mono text-[8.5px] font-medium leading-none tracking-[.14em] text-[rgba(242,241,238,.5)]">
                  {Math.round((prog / 100) * 1200)} / 1200 M
                </span>
              </div>
              <span className="relative block h-[2px] rounded-[2px] bg-[rgba(242,241,238,.1)]">
                <span
                  className="absolute left-0 top-0 h-[2px] rounded-[2px]"
                  style={{
                    transition: "width .12s linear",
                    background:
                      "linear-gradient(90deg, rgba(201,179,126,.55), #E9E7E2)",
                    width: `${prog}%`,
                  }}
                />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* result */}
      {step === 3 && (
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-[250px] pt-[34px]">
          <span className="font-mono text-[9px] font-medium leading-none tracking-[.28em] text-[rgba(242,241,238,.4)]">
            {isTrack ? "TRACK" : "OFF-ROAD"}
          </span>
          <span
            className="mt-[14px] text-[34px] leading-[1.05] tracking-[-.01em]"
            style={{ color: win ? "#F5F4F1" : "rgba(242,241,238,.55)" }}
          >
            {win ? "You win" : "You lose"}
          </span>
          <span className="mt-[10px] font-mono text-[13px] font-medium leading-none tracking-[.16em] text-accent">
            {win ? "+0.09 SOL" : "−0.05 SOL"}
          </span>

          <div className="mt-[30px] flex w-full flex-col gap-[18px]">
            {[
              {
                name: pickedCar?.name ?? "You",
                hp: yourHp,
                color: "#F2F1EE",
                fill: "linear-gradient(90deg, rgba(201,179,126,.6), #E0CD9C)",
              },
              {
                name: rivalCar?.name ?? "AMG GT Black Series",
                hp: oppHp,
                color: "rgba(242,241,238,.6)",
                fill: "linear-gradient(90deg, rgba(233,231,226,.35), rgba(233,231,226,.6))",
              },
            ].map((b) => (
              <div key={b.name} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] leading-none" style={{ color: b.color }}>
                    {b.name}
                  </span>
                  <span
                    className="font-mono text-[13px] font-medium leading-none"
                    style={{ color: b.color }}
                  >
                    {b.hp}
                  </span>
                </div>
                <span className="relative block h-[3px] rounded-[2px] bg-[rgba(242,241,238,.1)]">
                  <span
                    className="absolute left-0 top-0 h-[3px] rounded-[2px]"
                    style={{
                      transition: "width .7s cubic-bezier(.3,0,.2,1)",
                      background: b.fill,
                      width: `${Math.round((b.hp / maxHp) * 100)}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>

          <div
            className="mt-[26px] flex w-full items-center justify-between rounded-[14px] p-[14px]"
            style={{
              background: "rgba(255,255,255,.035)",
              border: ".5px solid rgba(233,231,226,.1)",
            }}
          >
            <span className="font-mono text-[10.5px] leading-none tracking-[.14em] text-[rgba(242,241,238,.4)]">
              NEW BALANCE
            </span>
            <span className="font-mono text-[13px] font-medium leading-none">
              {sol === null
                ? "—"
                : `${(sol + (win ? 0.09 : -0.05)).toFixed(2)} SOL`}
            </span>
          </div>
        </div>
      )}

      {/* winner reveal — the garage card, exact front design */}
      {finished && (
        <div
          className="fixed inset-0 z-30 mx-auto flex w-full max-w-[430px] flex-col items-center justify-center gap-5"
          style={{ background: "rgba(7,7,10,.88)", paddingBottom: "72px" }}
        >
          <div className="winner-in flex flex-col items-center gap-5">
            <span className="font-mono text-[16px] font-semibold leading-none tracking-[.34em] text-accent">
              WINNER
            </span>
            {(() => {
              const wc = (cards ?? []).find((c) => c.assetId === picked);
              const name = pickedCar?.name ?? "—";
              const num = wc ? `#${wc.assetId.slice(-4).toUpperCase()}` : "";
              return (
                <div className="relative">
                <div
                  className="relative h-[500px] w-[270px] overflow-hidden rounded-[22px]"
                  style={{
                    background: "#101016",
                    border: ".5px solid rgba(233,231,226,.34)",
                    boxShadow:
                      "0 26px 60px rgba(0,0,0,.6), inset 0 .5px 0 rgba(255,255,255,.14)",
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-0 z-[3] rounded-[22px]"
                    style={{
                      background:
                        "linear-gradient(147deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 34%, rgba(255,255,255,0) 66%, rgba(255,255,255,.035) 100%)",
                    }}
                  />
                  <div className="absolute left-0 right-0 top-0 h-[376px] overflow-hidden rounded-t-[22px]">
                    {pickedCar?.img && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pickedCar.img}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
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
                  <div className="absolute left-3 right-3 top-3 z-[5] flex items-start justify-between">
                    <span
                      className="rounded-[4px] px-2 py-1 font-mono text-[9px] font-semibold leading-none tracking-[.2em]"
                      style={{
                        background: "rgba(10,10,15,.72)",
                        border: ".5px solid rgba(233,231,226,.22)",
                      }}
                    >
                      RARE
                    </span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 z-[5] flex flex-col gap-[10px] px-[14px] pb-[15px]">
                    <div className="flex items-end justify-between">
                      <div className="flex flex-col gap-1">
                        <span
                          className="text-[19px] font-normal leading-[1.15] text-foreground-bright"
                          style={{ letterSpacing: ".005em" }}
                        >
                          {name}
                        </span>
                        <span className="font-mono text-[9.5px] leading-none tracking-[.16em] text-[rgba(242,241,238,.4)]">
                          {dateFor(wc?.time)}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] font-medium leading-none tracking-[.06em] text-accent">
                        {num}
                      </span>
                    </div>
                    <div
                      style={{
                        height: ".5px",
                        background:
                          "linear-gradient(90deg, rgba(233,231,226,.32), rgba(233,231,226,.04))",
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-medium leading-none tracking-[.13em] text-[rgba(242,241,238,.62)]">
                        {wc ? placeFor(wc.lat, wc.lon, wc.assetId) : ""}
                      </span>
                      <span className="font-mono text-[9px] font-medium leading-none tracking-[.14em] text-[rgba(242,241,238,.3)]">
                        TAP FOR SPECS
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFinished(false);
                    setRacing(false);
                    setStep(3);
                  }}
                  aria-label="Close"
                  className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  style={{
                    border: ".5px solid rgba(233,231,226,.25)",
                    background: "#15151C",
                    boxShadow: "0 8px 20px rgba(0,0,0,.55)",
                  }}
                >
                  <span className="relative block h-[11px] w-[11px]" aria-hidden>
                    <span
                      className="absolute left-0 top-1/2 h-px w-full rotate-45"
                      style={{ background: "rgba(242,241,238,.75)" }}
                    />
                    <span
                      className="absolute left-0 top-1/2 h-px w-full -rotate-45"
                      style={{ background: "rgba(242,241,238,.75)" }}
                    />
                  </span>
                </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* footer — scrim fade overlay; hidden during the live race so the
          telemetry never sits under the fade */}
      {!racing && (
      <div
        className="absolute inset-x-0 z-10 flex flex-col gap-[9px]"
        style={{
          bottom: 0,
          padding: "34px 20px calc(max(env(safe-area-inset-bottom), 16px) + 82px)",
          // fade only over the scrolling list steps — on static screens
          // (confirm match, result) it would dim resting content
          background:
            step <= 1
              ? "linear-gradient(180deg, rgba(16,16,21,0) 0%, rgba(16,16,21,.96) 18%, #101015 28%)"
              : "none",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            disabled={racing || (step < 3 && !ready)}
            onClick={primary}
            className="flex h-[54px] flex-1 items-center justify-center rounded-[15px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 active:scale-[.97]"
            style={{
              transition:
                "opacity .25s ease, background .15s ease, transform .1s ease",
              opacity: racing ? 0.4 : step === 3 || ready ? 1 : 0.4,
              background: flash ? "#C9B37E" : "#14141A",
              border: `1px solid ${flash ? "#E0CD9C" : "rgba(201,179,126,.6)"}`,
              boxShadow:
                "0 10px 30px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
            }}
          >
            <span
              className="font-mono text-[12px] font-semibold leading-none tracking-[.3em]"
              style={{ color: flash ? "#0A0A0F" : "#F2F1EE" }}
            >
              {racing
                ? "RACING…"
                : [
                    fromGarage ? "SELECT AN OPPONENT" : "SELECT A CAR",
                    "CHOOSE TERRAIN",
                    "START RACE",
                    "RACE AGAIN",
                  ][step]}
            </span>
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
