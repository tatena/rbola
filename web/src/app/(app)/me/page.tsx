"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { hasAuth, shortAddress, useOwner } from "@/lib/useOwner";

// Profile (ME) screen — design_handoff_camera_screen prototype, screen 1e.
// Real data: SOL balance, car count, collection thumbs, latest mint event.
// Placeholder until the race economy exists: win rate, races/wins/streak,
// race activity rows (founder-approved demo values). No token — SOL only.

type ApiCard = {
  assetId: string;
  name: string;
  photo: string | null;
  rarity: string | null;
  time: string | null;
};


type ActivityRow = {
  title: string;
  when: string;
  amount: string;
  color: string;
  dot: string;
};

const mutedRow = {
  color: "rgba(242,241,238,.6)",
  dot: "rgba(242,241,238,.4)",
};

const WON_ROW: ActivityRow = {
  title: "Won Track vs @kv_213",
  when: "TODAY 09:52",
  amount: "+0.09",
  color: "#C9B37E",
  dot: "#C9B37E",
};

const FALLBACK_MINT_ROW: ActivityRow = {
  title: "Minted Porsche 944 #0407",
  when: "YESTERDAY 18:04",
  amount: "−0.02",
  ...mutedRow,
};

function whenFor(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const hm = d
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    .toUpperCase();
  const day = new Date(d).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return `TODAY ${hm}`;
  if (diff === 1) return `YESTERDAY ${hm}`;
  const dm = d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .toUpperCase();
  return `${dm} ${hm}`;
}

function stripPrefix(name: string) {
  return name.replace(/^RBOLA · /, "");
}

const microLabel = (ls: string, color: string) =>
  ({
    font: "500 7.5px/1 ui-monospace,Menlo,monospace",
    letterSpacing: ls,
    color,
  }) as const;

// quiet skeleton shimmer while /api/garage loads
function Sk({ w, h }: { w: number; h: number }) {
  return (
    <span
      className="inline-block animate-pulse rounded-[4px]"
      style={{ width: w, height: h, background: "rgba(255,255,255,.08)" }}
      aria-hidden
    />
  );
}

function SessionPill() {
  const { ready, authenticated, login, logout } = usePrivy();

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => (authenticated ? logout() : login())}
      className="flex h-8 flex-none items-center justify-center rounded-full px-4 disabled:opacity-40"
      style={{
        border: ".5px solid rgba(233,231,226,.2)",
        background: "rgba(255,255,255,.04)",
      }}
    >
      <span
        className="font-mono text-[9px] font-medium leading-none tracking-[.22em]"
        style={{ color: "rgba(242,241,238,.7)" }}
      >
        {!ready ? "···" : authenticated ? "LOG OUT" : "LOG IN"}
      </span>
    </button>
  );
}

export default function MePage() {
  const [cards, setCards] = useState<ApiCard[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [sol, setSol] = useState<number | null>(null);

  // profile follows the logged-in wallet (auth provider lives in the layout);
  // while the session/embedded wallet is resolving, hold the fetch — the
  // logged-out fallback must never show for an authenticated user
  const { owner, pending, authenticated } = useOwner();
  useEffect(() => {
    if (pending) return;
    setCards(null);
    setTotal(null);
    setSol(null);
    fetch(`/api/garage${owner ? `?owner=${owner}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return;
        setCards(j.cards ?? []);
        setTotal(j.total ?? null);
        setSol(j.sol ?? null);
      })
      .catch(() => {});
  }, [owner, pending]);

  const thumbs = (cards ?? [])
    .filter((c) => c.photo)
    .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""))
    .slice(0, 4);

  const latestMint: ActivityRow | null = thumbs[0]
    ? {
        title: `Minted ${stripPrefix(thumbs[0].name)}`,
        when: whenFor(thumbs[0].time),
        amount: "−0.02",
        ...mutedRow,
      }
    : null;
  const activity =
    cards === null
      ? [WON_ROW]
      : [WON_ROW, latestMint ?? FALLBACK_MINT_ROW];

  const loading = cards === null;

  const balances: { label: string; value: React.ReactNode; gold: boolean }[] = [
    {
      label: "SOL",
      value: loading ? <Sk w={44} h={15} /> : (sol?.toFixed(2) ?? "—"),
      gold: false,
    },
    { label: "WIN RATE", value: "68%", gold: true },
  ];

  const stats: { label: string; value: React.ReactNode }[] = [
    {
      label: "CARS",
      value: loading ? <Sk w={22} h={14} /> : String(total ?? "—"),
    },
    { label: "RACES", value: "24" },
    { label: "WINS", value: "16" },
    { label: "STREAK", value: "5" },
  ];

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={{
        background: "linear-gradient(180deg,#0A0A0F,#101015)",
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 134px)",
      }}
    >
      {/* identity */}
      <div className="flex items-center gap-[14px] px-5 pt-4">
        <span
          className="block h-14 w-14 flex-none overflow-hidden rounded-full bg-surface"
          style={{ border: ".5px solid rgba(233,231,226,.2)" }}
        >
          <img
            src="/avatar-nino.jpg"
            alt="Nino"
            className="h-full w-full object-cover"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
          <span className="text-[19px] leading-[1.1] tracking-[-.005em] text-foreground-bright">
            Nino Tatenashvili
          </span>
          <span
            className="font-mono text-[9px] leading-none tracking-[.14em]"
            style={{ color: "rgba(242,241,238,.34)" }}
          >
            {owner
              ? shortAddress(owner)
              : authenticated
                ? "WALLET CREATING…"
                : "NOT LOGGED IN"}
          </span>
        </span>
        {hasAuth && <SessionPill />}
      </div>

      {/* balances */}
      <div className="flex gap-[9px] px-5 pt-[22px]">
        {balances.map((b) => (
          <div
            key={b.label}
            className="flex flex-1 flex-col gap-2 rounded-[14px] px-[14px] py-[13px]"
            style={{
              background: b.gold
                ? "rgba(201,179,126,.08)"
                : "rgba(255,255,255,.04)",
              border: `.5px solid ${
                b.gold ? "rgba(201,179,126,.32)" : "rgba(233,231,226,.12)"
              }`,
            }}
          >
            <span
              style={microLabel(
                ".2em",
                b.gold ? "rgba(201,179,126,.8)" : "rgba(242,241,238,.34)",
              )}
            >
              {b.label}
            </span>
            <span
              className="font-mono text-[17px] font-medium leading-none"
              style={{ color: b.gold ? "#C9B37E" : "#F2F1EE" }}
            >
              {b.value}
            </span>
          </div>
        ))}
      </div>

      {/* stat strip */}
      <div
        className="mx-5 mt-[22px] grid grid-cols-4"
        style={{
          borderTop: ".5px solid rgba(233,231,226,.1)",
          borderBottom: ".5px solid rgba(233,231,226,.1)",
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center gap-[7px] py-[13px]"
          >
            <span className="font-mono text-base font-medium leading-none text-foreground">
              {s.value}
            </span>
            <span style={microLabel(".18em", "rgba(242,241,238,.34)")}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* activity */}
      <div className="flex flex-col px-5 pt-[22px]">
        <span
          className="mb-2 font-mono text-[8.5px] font-medium leading-none tracking-[.22em]"
          style={{ color: "rgba(242,241,238,.36)" }}
        >
          ACTIVITY
        </span>
        {activity.map((a) => (
          <div
            key={a.title}
            className="flex items-center gap-3 py-[11px]"
            style={{ borderTop: ".5px solid rgba(233,231,226,.08)" }}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <span
                className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] leading-[1.15]"
                style={{ color: "rgba(242,241,238,.86)" }}
              >
                {a.title}
              </span>
              <span
                className="font-mono text-[10px] leading-none tracking-[.12em]"
                style={{ color: "rgba(242,241,238,.32)" }}
              >
                {a.when}
              </span>
            </span>
          </div>
        ))}
        {loading && (
          <div
            className="flex items-center gap-3 py-[11px]"
            style={{ borderTop: ".5px solid rgba(233,231,226,.08)" }}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <Sk w={150} h={11} />
              <Sk w={70} h={8} />
            </span>
          </div>
        )}
      </div>

      {/* withdraw — inert until the withdraw flow lands; fixed above the nav
          so it stays visible on short viewports */}
      <div
        className="fixed inset-x-0 z-10 mx-auto w-full max-w-[430px] px-5"
        style={{ bottom: "calc(max(env(safe-area-inset-bottom), 16px) + 82px)" }}
      >
        <div
          className="flex h-[50px] items-center justify-center rounded-[14px]"
          style={{
            background: "#14141A",
            border: ".5px solid rgba(201,179,126,.55)",
            boxShadow:
              "0 10px 28px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.07)",
          }}
        >
          <span className="font-mono text-[11px] font-semibold leading-none tracking-[.28em] text-foreground">
            WITHDRAW SOL
          </span>
        </div>
      </div>
    </div>
  );
}
