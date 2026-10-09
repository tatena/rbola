"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { hasAuth } from "@/lib/useOwner";

// Race entry client: create entry → the player's wallet signs the server-built
// entry transfer → server broadcasts + queues. `enter` resolves with the entry
// id once committed; the live screen (/race/live/[id]) then watches it via
// useRaceWatch — searching → matched → paid. Practice skips the signature
// (no SOL) and comes back already resolved.

export type RaceView = {
  id: string;
  status: "awaiting_payment" | "confirming" | "searching" | "matched" | "cancelled";
  track: string;
  room: string;
  fee: number;
  car: { name: string; photo: string | null; rarity: string | null };
  paySig: string | null;
  opponent: { name: string; photo: string | null; rarity: string | null; driver: string } | null;
  result: { outcome: "win" | "loss" | "tie"; score: number; opponentScore: number } | null;
  payout: { kind: "win" | "refund"; lamports: number; status: "pending" | "sent"; sig: string | null } | null;
};

export type RacePhase = "idle" | "signing" | "entering" | "error";

type Signer = (tx: Uint8Array, owner: string) => Promise<Uint8Array>;

export function useRaceEntry() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (!hasAuth) return useRaceEntryWith(null);
  // hasAuth is a build-time constant, so the hook order is stable at runtime
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useRaceEntryWithPrivy();
}

function useRaceEntryWithPrivy() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const sign: Signer = async (tx, owner) => {
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) throw new Error("wallet not ready");
    const { signedTransaction } = await signTransaction({
      transaction: tx,
      wallet,
      chain: "solana:devnet",
    });
    return signedTransaction;
  };
  return useRaceEntryWith(sign);
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function api(url: string, body?: object): Promise<RaceView & { entry?: RaceView; tx?: string | null }> {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `race request failed (${res.status})`);
  return json;
}

// finished = resolved and any money movement for this player has landed
export const finished = (v: RaceView) =>
  v.status === "cancelled"
    ? !v.payout || v.payout.status === "sent"
    : v.status === "matched" && (!v.payout || v.payout.status === "sent");

function useRaceEntryWith(sign: Signer | null) {
  const [phase, setPhase] = useState<RacePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // → the committed entry id (paid + queued, or practice resolved), or null
  const enter = useCallback(
    async (p: { owner: string | null; assetId: string; track: string; room: string }) => {
      setError(null);
      try {
        setPhase(p.room === "practice" ? "entering" : "signing");
        const { entry, tx } = await api("/api/race/entry", p);
        if (tx) {
          if (!sign || !p.owner) throw new Error("log in to race for SOL");
          const signed = await sign(b64ToBytes(tx), p.owner);
          setPhase("entering");
          await api(`/api/race/entry/${entry!.id}/confirm`, { signedTx: bytesToB64(signed) });
        }
        return entry!.id;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
        return null;
      }
    },
    [sign],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  return { phase, error, enter, reset };
}

// Live view of one entry — polls the server (source of truth) until the race
// is resolved and this player's payout/refund has landed. Survives reloads:
// everything comes from GET /api/race/entry/[id].
export function useRaceWatch(id: string | null) {
  const [view, setView] = useState<RaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      try {
        const v = await api(`/api/race/entry/${id}`);
        if (!alive) return;
        setView(v);
        setError(null);
        if (finished(v)) return;
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        if (msg === "entry not found") return;
      }
      timer = setTimeout(tick, 1500);
    };
    kick.current = tick;
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  // cancel while searching = full refund; if a match landed first the server
  // answers 409 and polling simply carries on into the reveal
  const cancel = useCallback(async () => {
    if (!id) return;
    setCancelling(true);
    try {
      setView(await api(`/api/race/entry/${id}/cancel`, {}));
    } catch {
      /* matched in the meantime — the next poll shows it */
    } finally {
      setCancelling(false);
      kick.current();
    }
  }, [id]);

  return { view, error, cancel, cancelling };
}
