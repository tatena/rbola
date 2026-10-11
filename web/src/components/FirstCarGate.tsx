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

// Full-screen gate per Claude Design "RBOLA No Car Gate": drifting grayscale
// hero, glass card with the breathing R mark and the CAPTURE / LOG IN button.
export default function FirstCarGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gate = useFirstCar();
  const { authenticated } = useOwner();
  const { login } = useAuthActions();
  const [opening, setOpening] = useState(false);
  // signed out: the gate's button signs in first; the gate then re-checks
  // the wallet's garage (returning players go straight through)
  const signIn = hasAuth && !authenticated;
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
          className="gate-drift absolute inset-0 bg-no-repeat"
          style={{
            backgroundImage: "url(/gate-hero.jpg)",
            // zoomed past cover so the photo's dark studio ceiling crops off the top
            backgroundSize: "auto 128%",
            backgroundPosition: "50% 78%",
            transformOrigin: "50% 43%",
            filter: "grayscale(1) brightness(.62) contrast(1.3)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,rgba(10,10,15,.2) 0%,rgba(10,10,15,.1) 35%,rgba(10,10,15,.5) 62%,#0A0A0F 86%)",
          }}
        />
      </div>

      {/* card (with its button inside) sits above the nav; shrinks on short phones */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-center" style={{ bottom: 120, paddingTop: 130 }}>
        <div
          className="gate-rise relative overflow-hidden rounded-[18px]"
          style={{
            width: 244,
            height: "min(480px, 100%)",
            // smoked glass: the car still reads through the card
            background: "rgba(14,14,20,.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: ".75px solid rgba(233,231,226,.5)",
            boxShadow: "0 34px 70px rgba(0,0,0,.7)",
          }}
        >
          <div className="absolute inset-x-0 top-0 flex items-center justify-center" style={{ bottom: 220 }}>
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
            style={{ bottom: 104, paddingLeft: ".24em", textWrap: "balance" }}
          >
            CAPTURE YOUR FIRST CAR
          </h1>

          {/* the card's own foot: a champagne label, no box — the whole
              strip is the tap target */}
          <button
            onClick={signIn ? login : goCatch}
            aria-label={signIn ? "Log in" : "Catch a car"}
            className="absolute inset-x-[7px] bottom-[7px] z-10 flex h-[62px] items-center justify-center rounded-b-[12px] text-accent transition-[background] duration-[250ms] active:bg-[rgba(201,179,126,.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            style={{ background: opening ? "rgba(201,179,126,.08)" : undefined }}
          >
            <span className="pl-[.34em] font-mono text-[11px] leading-none tracking-[.34em]">
              {signIn ? "LOG IN" : "CAPTURE"}
            </span>
          </button>
        </div>
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
