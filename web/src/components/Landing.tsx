"use client";

/* eslint-disable @next/next/no-img-element */
import { Marcellus } from "next/font/google";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

// Landing page body per Claude Design "RBOLA Landing": hero → spot/capture/race
// loop → garage marquee → track shelf → closing strip. Styles in landing.css.

const marcellus = Marcellus({ weight: "400", subsets: ["latin"] });

const A = "/landing";

// ---- flow: SPOT → CAPTURE → RACE, one beat each ----
const STEP_MS = 3600;
const STEPS = ["SPOT", "CAPTURE", "RACE"] as const;
// the race clip opens on a black lead-in — loops start one second in
const VIDEO_SKIP = 1;

function Flow() {
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [flash, setFlash] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const flashT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const go = useCallback((next: number) => {
    const v = video.current;
    if (v && next === 2) {
      v.muted = true;
      try {
        v.currentTime = VIDEO_SKIP;
      } catch {}
      v.play().catch(() => {});
    }
    setStep(next);
    setRun((r) => r + 1);
    // CAPTURE fires a shutter flash
    clearTimeout(flashT.current);
    setFlash(next === 1);
    if (next === 1) flashT.current = setTimeout(() => setFlash(false), 90);
  }, []);

  // each beat (auto or tapped) schedules the next one
  useEffect(() => {
    const t = setTimeout(() => go((step + 1) % 3), STEP_MS);
    return () => clearTimeout(t);
  }, [step, run, go]);

  useEffect(() => {
    const v = video.current;
    const skip = () => {
      if (v && v.currentTime < VIDEO_SKIP) {
        try {
          v.currentTime = VIDEO_SKIP;
        } catch {}
      }
    };
    v?.addEventListener("timeupdate", skip);
    v?.addEventListener("loadedmetadata", skip);
    return () => {
      clearTimeout(flashT.current);
      v?.removeEventListener("timeupdate", skip);
      v?.removeEventListener("loadedmetadata", skip);
    };
  }, []);

  const center = "translate(-50%,-50%)";
  return (
    <section className="l-flow">
      <div className="l-stage">
        <div
          className="l-layer"
          style={{ opacity: step === 2 ? 0 : 1, transform: step === 0 ? "scale(1.08)" : "scale(1)" }}
        >
          <img
            src={`${A}/artura-street.jpg`}
            alt=""
            style={{ objectPosition: "45% 38%", filter: "saturate(.8) contrast(1.04)" }}
          />
        </div>
        <div
          className="l-layer"
          style={{
            opacity: step === 2 ? 1 : 0,
            transform: step === 2 ? "scale(1.08)" : "scale(1)",
            transition: "opacity 1.2s ease, transform 6s cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <video
            ref={video}
            src={`${A}/race.mp4#t=1`}
            poster={`${A}/race-poster.jpg`}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            style={{ filter: "saturate(.9) contrast(1.06)" }}
          />
        </div>
        <div
          className="l-layer"
          style={{
            background:
              step === 0 ? "rgba(10,10,15,.1)" : step === 2 ? "rgba(10,10,15,0)" : "rgba(10,10,15,.62)",
            transition: "background 1s ease",
          }}
        />

        {/* SPOT: viewfinder brackets lock onto the car */}
        <div
          className="l-finder"
          style={{
            opacity: step === 0 ? 1 : 0,
            transform: `${center} scale(${step === 0 ? 1 : 1.25})`,
          }}
        >
          <span />
          <span />
          <span />
          <span />
        </div>

        {/* CAPTURE: the catch seals into a card */}
        <div
          className="l-mini"
          style={{
            opacity: step === 1 ? 1 : 0,
            transform: step === 0 ? `${center} scale(1.2)` : step === 1 ? center : `${center} scale(.92)`,
          }}
        >
          <img src={`${A}/artura-street.jpg`} alt="" />
          <div className="l-mini-fade" />
          <div className="l-gloss" />
          <span className="l-tag">RARE</span>
          <div className="l-mini-foot">
            <div className="l-mini-row">
              <span>McLaren Artura</span>
              <span>#0231</span>
            </div>
            <div className="l-mini-rule" />
          </div>
        </div>

        <div
          className="l-flash"
          style={{ opacity: flash ? 0.85 : 0, transition: flash ? "opacity 0s" : "opacity .9s ease" }}
        />
      </div>

      <div className="l-steps">
        {STEPS.map((label, i) => (
          <button key={label} type="button" className="l-step" onClick={() => go(i)}>
            <span className="l-step-track">
              {i === step && (
                // keyed by run: the bar restarts with every beat
                <span
                  key={run}
                  className="l-step-fill"
                  style={{ animation: `l-bar ${STEP_MS}ms linear forwards` }}
                />
              )}
            </span>
            <span
              className="l-step-label"
              style={{ color: i === step ? "#F2F1EE" : "rgba(242,241,238,.32)" }}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- garage marquee: one card in focus, rolling on ----
const GARAGE = [
  { name: "McLaren Artura", num: "#0231", rarity: "RARE", spot: "MIAMI", img: "artura.jpg" },
  { name: "Apollo IE", num: "#0118", rarity: "LEGENDARY", spot: "GOODWOOD", img: "apollo-ie.jpg" },
  { name: "Pagani Zonda R", num: "#0407", rarity: "EPIC", spot: "MONACO", img: "zonda-r.jpg" },
  { name: "AMG GT Black Series", num: "#0388", rarity: "RARE", spot: "STUTTGART", img: "amg-gt-black.jpg" },
  { name: "Koenigsegg Jesko", num: "#0092", rarity: "LEGENDARY", spot: "LONDON", img: "jesko.jpg" },
  { name: "Mercedes-AMG One", num: "#0154", rarity: "EPIC", spot: "COMO", img: "amg-one.webp" },
];
// three copies: focus walks the middle set, then jumps back invisibly
const RAIL = [...GARAGE, ...GARAGE, ...GARAGE];
const CARD_STEP = 278; // card width 250 + gap 28

function Garage() {
  const [gi, setGi] = useState(6);
  const [jump, setJump] = useState(false);

  useEffect(() => {
    let g = 6;
    let jumpT: ReturnType<typeof setTimeout> | undefined;
    const t = setInterval(() => {
      g += 1;
      setJump(false);
      setGi(g);
      // past the middle set: snap back to its twin card with no transition
      if (g >= 12) {
        jumpT = setTimeout(() => {
          g = 6;
          setJump(true);
          setGi(6);
        }, 1000);
      }
    }, 2800);
    return () => {
      clearInterval(t);
      clearTimeout(jumpT);
    };
  }, []);

  return (
    <section className="l-garage">
      <h2 className="l-h2">
        Every catch is <em>one of one</em>
      </h2>
      <div className="l-rail">
        <div
          className="l-rail-track"
          style={{
            transform: `translateX(${-(gi * CARD_STEP + 125)}px)`,
            transition: jump ? "none" : "transform 1s cubic-bezier(.65,0,.35,1)",
          }}
        >
          {RAIL.map((c, i) => (
            <div
              key={i}
              className={`l-gcard${i === gi ? " on" : Math.abs(i - gi) === 1 ? " near" : ""}`}
            >
              <div className="l-gcard-photo">
                <img src={`${A}/${c.img}`} alt={i === gi ? c.name : ""} />
              </div>
              <div className="l-gcard-fade" />
              <div className="l-gloss" />
              <span className="l-tag">{c.rarity}</span>
              <div className="l-gcard-foot">
                <div className="l-gcard-row">
                  <span>{c.name}</span>
                  <span>{c.num}</span>
                </div>
                <div className="l-gcard-rule" />
                <span className="l-gcard-spot">{c.spot}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- tracks: the shelf opens one road at a time ----
const TRACKS = [
  { name: "HIGHWAY RUN", img: "track-highway.jpg", gauges: [55, 25, 20] },
  { name: "MOUNTAIN PASS", img: "track-mountain.jpg", gauges: [20, 25, 55] },
  { name: "DRAG STRIP", img: "track-drag.jpg", gauges: [35, 60, 5] },
];
const GAUGES = ["SPD", "ACC", "HDL"];

function Tracks() {
  const [tk, setTk] = useState(0);
  const [run, setRun] = useState(0);
  // each opening (auto or hovered) holds 3.6s, then the next road opens
  useEffect(() => {
    const t = setTimeout(() => {
      setTk((k) => (k + 1) % 3);
      setRun((r) => r + 1);
    }, 3600);
    return () => clearTimeout(t);
  }, [run]);

  const open = (i: number) => {
    if (i === tk) return;
    setTk(i);
    setRun((r) => r + 1);
  };

  return (
    <section className="l-tracks">
      <h2 className="l-h2" style={{ padding: 0 }}>
        Two drivers. <em>One road.</em>
      </h2>
      <div className="l-shelf">
        {TRACKS.map((t, i) => {
          const on = i === tk;
          return (
            <button
              key={t.name}
              type="button"
              className={`l-track${on ? " on" : ""}`}
              onMouseEnter={() => open(i)}
              onClick={() => open(i)}
              aria-label={t.name}
              aria-pressed={on}
            >
              <img src={`${A}/${t.img}`} alt="" />
              <span className="l-track-scrim" />
              <span className="l-track-dim" />
              <span className="l-track-body">
                <span className={`l-track-name ${marcellus.className}`}>
                  {[...t.name].map((ch, k) => (
                    <span
                      key={on ? `${run}-${k}` : `s-${k}`}
                      className={on ? "l-rise" : undefined}
                      style={on ? { animationDelay: `${0.15 + k * 0.04}s` } : undefined}
                    >
                      {ch}
                    </span>
                  ))}
                </span>
                {on && (
                  <span className="l-gauges" key={run}>
                    {t.gauges.map((v, g) => (
                      <span
                        key={GAUGES[g]}
                        className="l-gauge l-rise"
                        style={{ animationDelay: `${0.55 + g * 0.12}s` }}
                      >
                        <svg viewBox="0 0 56 32" width="68" height="39">
                          <path
                            d="M4 30 A24 24 0 0 1 52 30"
                            fill="none"
                            stroke="rgba(242,241,238,.14)"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                          />
                          <path
                            className="l-gauge-arc"
                            d="M4 30 A24 24 0 0 1 52 30"
                            fill="none"
                            stroke="rgba(201,179,126,.9)"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            pathLength={1}
                            style={{ strokeDashoffset: 1 - v / 100, animationDelay: `${0.75 + g * 0.12}s` }}
                          />
                          <line
                            className="l-gauge-needle"
                            x1="28"
                            y1="30"
                            x2="28"
                            y2="10"
                            stroke="rgba(242,241,238,.65)"
                            strokeWidth="1"
                            strokeLinecap="round"
                            style={{ transform: `rotate(${-90 + v * 1.8}deg)`, animationDelay: `${0.75 + g * 0.12}s` }}
                          />
                          <circle cx="28" cy="30" r="1.6" fill="rgba(242,241,238,.65)" />
                        </svg>
                        <span>{GAUGES[g]}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---- socials: top right of the header, opposite the mark ----
const SOCIALS = [
  {
    label: "X",
    href: "https://x.com/rbola_fun",
    icon: <path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  },
  {
    label: "Instagram",
    href: "#",
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="16.9" cy="7.1" r=".9" fill="currentColor" />
      </>
    ),
  },
  {
    label: "Discord",
    href: "#",
    icon: (
      <>
        <path
          d="M7.5 7.2c3-1.3 6-1.3 9 0 1.6 2.3 2.4 4.9 2.3 8.1-1.3 1-2.7 1.7-4.2 2.1l-1-1.6M9.4 15.8l-1 1.6c-1.5-.4-2.9-1.1-4.2-2.1-.1-3.2.7-5.8 2.3-8.1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9.6" cy="12.4" r="1.2" fill="currentColor" />
        <circle cx="14.4" cy="12.4" r="1.2" fill="currentColor" />
      </>
    ),
  },
  {
    label: "Telegram",
    href: "#",
    icon: (
      <path
        d="M20.5 4.5L3.8 11.1l5.6 2.1 2.1 6.3 3.1-4 4.6 3.4z M9.4 13.2l8.4-6.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    ),
  },
];

// ---- the way in: GET RBOLA opens the app ----
// `npm run dev` stays on the local server instead of jumping to production
const APP_URL =
  process.env.NODE_ENV === "development" ? "/catch" : "https://app.rbola.fun/catch";

function GetRbola() {
  return (
    <a href={APP_URL} className="l-get">
      GET RBOLA
    </a>
  );
}

function Socials() {
  return (
    <span className="l-socials">
      {SOCIALS.map((s, i) => (
        <a
          key={s.label}
          href={s.href}
          aria-label={s.label}
          className="l-social"
          style={{ "--d": `${0.5 + i * 0.08}s` } as CSSProperties}
          {...(s.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            {s.icon}
          </svg>
        </a>
      ))}
    </span>
  );
}

export default function Landing() {
  return (
    <main className="landing">
      <header className="l-header">
        <Link href="/" aria-label="RBOLA" className="l-brand">
          <img src="/rbola-r-mark.png" alt="" />
          <span>BOLA</span>
        </Link>
        <span className="l-header-right">
          <Socials />
          <GetRbola />
        </span>
      </header>

      <section className="l-hero">
        <div className="l-hero-bg">
          <img src={`${A}/hero.jpg`} alt="" />
        </div>
        <h1>Own the cars that turn your head</h1>
      </section>

      <Flow />
      <Garage />
      <Tracks />
    </main>
  );
}
