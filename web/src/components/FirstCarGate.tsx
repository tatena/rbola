"use client";

import { Marcellus } from "next/font/google";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFirstCar } from "@/lib/useFirstCar";
import { hasAuth, useAuthActions, useOwner } from "@/lib/useOwner";

const marcellus = Marcellus({ weight: "400", subsets: ["latin"] });

// screens a player without a car can still use: the camera (onboarding) and
// the dev-only bulk upload tool
export const GATE_OPEN = ["/catch", "/upload"];

const CAM_ICON =
  "M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5zM12 15.6a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z";

// Full-screen gate per Claude Design "RBOLA No Car Gate": drifting grayscale
// hero, glass card with the breathing R mark, CAPTURE above the nav.
export default function FirstCarGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gate = useFirstCar();
  const { authenticated } = useOwner();
  const { login } = useAuthActions();
  const [opening, setOpening] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (GATE_OPEN.some((p) => pathname.startsWith(p)) || gate === "open") return children;
  if (gate === "checking") return <div className="flex-1" />;

  // brief OPENING CAMERA beat so the tap reads before the route swaps
  const goCatch = () => {
    setOpening(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.push("/catch"), 450);
  };

  return (
    <main className="fixed inset-0 z-10 mx-auto w-full max-w-[430px] overflow-hidden bg-background text-foreground">
      {/* hero: grayscale car, slow drift, scrim into the base color */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="gate-drift absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url(/gate-hero.jpg)",
            transformOrigin: "50% 43%",
            filter: "grayscale(1) brightness(.62) contrast(1.3)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,rgba(10,10,15,.55) 0%,rgba(10,10,15,.35) 35%,rgba(10,10,15,.6) 60%,#0A0A0F 84%)",
          }}
        />
      </div>

      {/* card sits in the space above CAPTURE; shrinks on short phones */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-center" style={{ bottom: 202, paddingTop: 130 }}>
        <div
          className="gate-rise relative overflow-hidden rounded-[18px]"
          style={{
            width: 244,
            height: "min(400px, 100%)",
            background: "rgba(14,14,20,.8)",
            backdropFilter: "blur(22px) saturate(.8)",
            WebkitBackdropFilter: "blur(22px) saturate(.8)",
            border: ".75px solid rgba(233,231,226,.5)",
            boxShadow: "0 34px 70px rgba(0,0,0,.7)",
          }}
        >
          <div className="absolute inset-x-0 top-0 flex items-center justify-center" style={{ bottom: 150 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rbola-r-mark.png" alt="" className="gate-breath block w-[68px]" />
          </div>
          <span
            className="gate-sheen pointer-events-none absolute left-0 top-0 h-full w-[70px]"
            style={{
              transform: "translateX(-140px)",
              background: "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.13),rgba(255,255,255,0))",
            }}
          />
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(147deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,0) 34%,rgba(255,255,255,0) 66%,rgba(255,255,255,.035) 100%)",
            }}
          />
          <span
            className="pointer-events-none absolute rounded-[12px]"
            style={{ inset: 7, border: ".5px solid rgba(233,231,226,.16)" }}
          />
          <h1
            className={`${marcellus.className} absolute inset-x-0 mx-auto max-w-[200px] text-center text-[15px] font-normal leading-normal tracking-[.24em]`}
            style={{ bottom: 30, paddingLeft: ".24em", textWrap: "balance" }}
          >
            CAPTURE YOUR FIRST CAR
          </h1>
        </div>
      </div>

      <div className="gate-rise absolute inset-x-6" style={{ bottom: 122, animationDelay: ".45s" }}>
        <button
          onClick={goCatch}
          aria-label="Catch a car"
          className="flex h-14 w-full items-center justify-center gap-3 rounded-[15px] transition-[background] duration-[250ms] hover:bg-[#1A1A21] active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{
            background: opening ? "#1A1A21" : "#14141A",
            border: "1px solid rgba(201,179,126,.6)",
            boxShadow: "0 10px 30px rgba(0,0,0,.5),inset 0 .5px 0 rgba(255,255,255,.08)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="block text-accent" aria-hidden>
            <path d={CAM_ICON} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-mono text-[12px] font-semibold leading-none tracking-[.3em]">CAPTURE</span>
        </button>

        {/* returning players on a fresh device: their cards are behind sign-in */}
        {hasAuth && !authenticated && (
          <button
            onClick={login}
            className="absolute inset-x-0 top-full mx-auto mt-3 block font-mono text-[9px] tracking-[.2em] text-[rgba(242,241,238,.34)]"
          >
            ALREADY CATCHING? SIGN IN
          </button>
        )}
      </div>

      <div
        className="absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-[9px] transition-opacity duration-500"
        style={{ top: 118, opacity: opening ? 1 : 0 }}
        aria-live="polite"
      >
        <span className="h-[5px] w-[5px] rotate-45 bg-accent" />
        <span className="whitespace-nowrap font-mono text-[9px] leading-none tracking-[.3em]">
          {opening ? "OPENING CAMERA" : ""}
        </span>
      </div>
    </main>
  );
}
