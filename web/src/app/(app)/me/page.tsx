"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { displayName, hasAuth, shortAddress, useOwner } from "@/lib/useOwner";

// Profile (ME) screen — design_handoff_camera_screen prototype, screen 1e.
// All real: SOL balance + cars (/api/garage), win rate / races / wins /
// streak + race rows (/api/race/stats, paid races only in the numbers;
// practice shows in activity). No token — SOL only. No withdraw in the
// devnet beta.

type ApiCard = {
  assetId: string;
  name: string;
  photo: string | null;
  rarity: string | null;
  time: string | null;
};
type RaceRow = {
  raceId: string;
  at: number;
  practice: boolean;
  opponent: string;
  outcome: "win" | "loss" | "tie";
};

type RaceStats = {
  races: number;
  wins: number;
  winRate: number | null;
  streak: number;
  recent: RaceRow[];
};

type ActivityRow = { key: string; at: number; title: string };

const ACTIVITY_ROWS = 4;

function raceTitle(r: RaceRow): string {
  const verb = { win: "Won", loss: "Lost", tie: "Tied" }[r.outcome];
  return `${verb}${r.practice ? " practice" : ""} vs ${r.opponent}`;
}

function whenFor(ms: number): string {
  const d = new Date(ms);
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
  // keyed by the wallet it was fetched for — a stale wallet's record reads
  // as loading, so no synchronous reset is needed in the effect
  const [race, setRace] = useState<{ key: string; stats: RaceStats } | null>(
    null,
  );

  // profile follows the logged-in wallet (auth provider lives in the layout);
  // while the session/embedded wallet is resolving, hold the fetch — the
  // logged-out fallback must never show for an authenticated user
  const { owner, pending, authenticated, email } = useOwner();
  const name = displayName(email);
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
    const key = owner ?? "";
    fetch(`/api/race/stats${owner ? `?owner=${owner}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.error) setRace({ key, stats: j });
      })
      .catch(() => {});
  }, [owner, pending]);
  const raceStats = race && race.key === (owner ?? "") ? race.stats : null;

  const mintRows: ActivityRow[] = (cards ?? [])
    .filter((c) => c.time)
    .map((c) => ({
      key: c.assetId,
      at: new Date(c.time!).getTime(),
      title: `Minted ${stripPrefix(c.name)}`,
    }));
  const raceRows: ActivityRow[] = (raceStats?.recent ?? []).map((r) => ({
    key: r.raceId,
    at: r.at,
    title: raceTitle(r),
  }));
  const activity = [...mintRows, ...raceRows]
    .sort((a, b) => b.at - a.at)
    .slice(0, ACTIVITY_ROWS);

  const loading = cards === null;
  const raceLoading = raceStats === null;

  const balances: { label: string; value: React.ReactNode; gold: boolean }[] = [
    {
      label: "SOL",
      value: loading ? <Sk w={44} h={15} /> : (sol?.toFixed(2) ?? "—"),
      gold: false,
    },
    {
      label: "WIN RATE",
      value: raceLoading ? (
        <Sk w={36} h={15} />
      ) : raceStats.winRate === null ? (
        "—"
      ) : (
        `${Math.round(raceStats.winRate * 100)}%`
      ),
      gold: true,
    },
  ];

  const stats: { label: string; value: React.ReactNode }[] = [
    {
      label: "CARS",
      value: loading ? <Sk w={22} h={14} /> : String(total ?? "—"),
    },
    ...(
      [
        ["RACES", "races"],
        ["WINS", "wins"],
        ["STREAK", "streak"],
      ] as const
    ).map(([label, k]) => ({
      label,
      value: raceLoading ? <Sk w={22} h={14} /> : String(raceStats[k]),
    })),
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
          className="flex h-14 w-14 flex-none items-center justify-center rounded-full"
          style={{
            border: ".5px solid rgba(201,179,126,.45)",
            background: "linear-gradient(180deg,#1A1A20,#121217)",
          }}
          aria-hidden
        >
          <span className="text-[20px] font-light leading-none text-accent">
            {name[0]}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
          <span className="text-[19px] leading-[1.1] tracking-[-.005em] text-foreground-bright">
            {name}
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

      {/* activity — absent entirely until there is something to list */}
      {(activity.length > 0 || loading || raceLoading) && (
        <div className="flex flex-col px-5 pt-[22px]">
          <span
            className="mb-2 font-mono text-[8.5px] font-medium leading-none tracking-[.22em]"
            style={{ color: "rgba(242,241,238,.36)" }}
          >
            ACTIVITY
          </span>
          {activity.map((a) => (
            <div
              key={a.key}
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
                  {whenFor(a.at)}
                </span>
              </span>
            </div>
          ))}
          {(loading || raceLoading) && (
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
      )}
    </div>
  );
}
