"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getDraft, getServerDraft, setGarageCache, subscribe } from "@/lib/mintStore";
import { hasAuth, useOwner } from "@/lib/useOwner";

// Onboarding gate: until a player owns their first card, only the camera is
// open — every other screen shows the "mint your first car" lock instead.
// "checking" renders nothing, so neither the lock nor the screen flashes.
export type FirstCar = "checking" | "locked" | "open";

const key = (owner: string) => `rbola.hasCar.${owner}`;
// owners already checked this session — later tab taps decide instantly
const known = new Map<string, boolean>();

function remembered(owner: string): boolean {
  try {
    return localStorage.getItem(key(owner)) === "1";
  } catch {
    return false;
  }
}

// sticky per wallet: collections are never wiped, so once is enough
export function markHasCar(owner: string | undefined) {
  if (!owner) return;
  known.set(owner, true);
  try {
    localStorage.setItem(key(owner), "1");
  } catch {}
}

export function useFirstCar(): FirstCar {
  const { owner, pending } = useOwner();
  // a mint in flight hands off to the garage — the gate must let it through
  const draft = useSyncExternalStore(subscribe, getDraft, getServerDraft);
  const [checked, setChecked] = useState<{ owner: string; has: boolean } | null>(null);

  const instant =
    owner === null ? undefined : known.get(owner) ?? (remembered(owner) ? true : undefined);

  useEffect(() => {
    if (!hasAuth || pending || !owner || instant) return;
    let live = true;
    fetch(`/api/garage?owner=${owner}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        const cards: unknown[] = j.cards ?? [];
        setGarageCache({ cards, sol: j.sol ?? null });
        if (cards.length > 0) markHasCar(owner);
        else known.set(owner, false);
        if (live) setChecked({ owner, has: cards.length > 0 });
      })
      // the gate is a UX guide, not a security boundary — never lock a
      // player out of their own garage over a flaky read
      .catch(() => live && setChecked({ owner, has: true }));
    return () => {
      live = false;
    };
  }, [owner, pending, instant]);

  // dev builds without auth read the founder wallet — nothing to gate
  if (!hasAuth || draft) return "open";
  if (pending) return "checking";
  if (!owner) return "locked";
  if (instant !== undefined) return instant ? "open" : "locked";
  if (checked?.owner === owner) return checked.has ? "open" : "locked";
  return "checking";
}
