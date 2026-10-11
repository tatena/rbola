"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFirstCar } from "@/lib/useFirstCar";
import { hasAuth, useAuthActions, useOwner } from "@/lib/useOwner";

// screens a player without a car can still use: the camera (onboarding) and
// the dev-only bulk upload tool
const OPEN = ["/catch", "/upload"];

// what each locked tab is waiting for — the one line that changes per screen
function unlocks(pathname: string) {
  if (pathname.startsWith("/garage")) return "YOUR GARAGE OPENS WITH YOUR FIRST CATCH";
  if (pathname.startsWith("/race")) return "RACING OPENS WITH YOUR FIRST CATCH";
  return "YOUR PROFILE OPENS WITH YOUR FIRST CATCH";
}

export default function FirstCarGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const gate = useFirstCar();
  const { authenticated } = useOwner();
  const { login } = useAuthActions();

  if (OPEN.some((p) => pathname.startsWith(p)) || gate === "open") return children;
  if (gate === "checking") return <div className="flex-1" />;

  return (
    <main
      key={pathname}
      className="page-enter flex flex-1 flex-col items-center justify-center px-8 text-center"
      style={{ paddingBottom: 90 }}
    >
      {/* hairline padlock */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#C9B37E"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
      </svg>

      <h1 className="mt-6 font-mono text-[12px] font-normal tracking-[.24em] text-foreground">
        MINT YOUR FIRST CAR
      </h1>
      <p className="mt-3 font-mono text-[9px] tracking-[.2em] text-[rgba(242,241,238,.4)]">
        {unlocks(pathname)}
      </p>

      <Link
        href="/catch"
        className="mt-10 flex h-10 items-center rounded-[20px] px-6 font-mono text-[10px] tracking-[.24em] text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ border: ".5px solid rgba(201,179,126,.5)", background: "rgba(201,179,126,.06)" }}
      >
        OPEN CAMERA
      </Link>

      {/* returning players on a fresh device: their cards are behind sign-in */}
      {hasAuth && !authenticated && (
        <button
          onClick={login}
          className="mt-6 font-mono text-[9px] tracking-[.2em] text-[rgba(242,241,238,.34)]"
        >
          ALREADY CATCHING? SIGN IN
        </button>
      )}
    </main>
  );
}
