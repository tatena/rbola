// Race ledger v0 — server-side state for entries, matches and SOL movements
// (Option B, locked 2026-10-06: server ledger + real on-chain SOL payouts, no
// smart contracts). JSON file on the dev server's disk (data/races.json, like
// the catch registry); one in-process lock serializes every state change so
// match / cancel / payout can never interleave.
//
// Lifecycle: awaiting_payment → (signed transfer confirmed) → searching →
// matched with a driver on the same (track, room) → resolved instantly (pure
// function) → payout / refund transfers. Paid rooms are player vs player only
// (founder call 10-11): no rival within NO_RIVAL_MS → full refund. The house
// car races only in free practice. A background tick (raceWorker) expires
// searches and sends payouts even when nobody is polling.

import fs from "node:fs";
import path from "node:path";
import { AuthError, authError } from "@/lib/auth";
import { REGISTRY_PATH, STATE_DIR } from "@/lib/dataDir";
import { heliusRpc } from "@/lib/cluster";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getEntry, type Rarity, type Spec } from "@/lib/catalog";
import {
  feeFor,
  isRoom,
  isTrack,
  payoutFor,
  resolve,
  type Room,
  type Track,
} from "@/lib/race";
import {
  broadcastPayout,
  buildEntryTx,
  txStatus,
  signPayout,
  signatureOf,
  submitEntryTx,
} from "@/lib/raceWallet";
import houseCars from "../../data/house-cars.json";

const LEDGER_PATH = path.join(STATE_DIR, "races.json");
const NO_RIVAL_MS = 60_000; // paid search with no rival → full refund
const STALE_CONFIRM_MS = 180_000; // longer than any live confirm can take
const PAYMENT_WINDOW_MS = 120_000; // an unpaid entry stops holding its card

export type Car = {
  assetId: string | null; // null = house car
  name: string;
  photo: string | null;
  rarity: Rarity | null;
  spec: Spec;
};

type Payout = {
  id: string;
  to: string;
  lamports: number;
  kind: "win" | "refund";
  status: "pending" | "sent";
  sig?: string;
  raw?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
};

type Entry = {
  id: string;
  owner: string;
  track: Track;
  room: Room;
  fee: number; // lamports
  car: Car;
  status: "awaiting_payment" | "confirming" | "searching" | "matched" | "cancelled";
  createdAt: number;
  message?: string; // issued entry-transfer message (base64)
  lastValidBlockHeight?: number;
  paySig?: string;
  searchingSince?: number;
  raceId?: string;
  refund?: Payout;
  // a broadcast whose confirmation was lost: it may still land, so the entry
  // can't be treated as unpaid until this signature is settled on-chain
  attemptSig?: string;
  confirmingSince?: number;
  endReason?: "left" | "no_rival";
};

type Race = {
  id: string;
  track: Track;
  room: Room;
  fee: number;
  a: string; // entry id
  b: string | null; // entry id, null = house
  house: Car | null;
  scoreA: number;
  scoreB: number;
  winner: "a" | "b" | "tie";
  payouts: Payout[];
  createdAt: number;
};

type Ledger = {
  entries: Record<string, Entry>;
  races: Record<string, Race>;
  houseCursor: Record<string, number>;
};

export class RaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function raceError(err: unknown) {
  if (err instanceof AuthError) return authError(err);
  if (err instanceof RaceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("race api", err);
  return NextResponse.json({ error: "race server error" }, { status: 500 });
}

// --- storage + lock ---

function load(): Ledger {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  } catch (err) {
    // only a missing file is a fresh ledger — an unreadable or corrupt one
    // must never be silently replaced (pending payouts would be lost)
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { entries: {}, races: {}, houseCursor: {} };
    }
    throw err;
  }
}

function save(l: Ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  const tmp = `${LEDGER_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(l, null, 2));
  fs.renameSync(tmp, LEDGER_PATH);
}

// global so every route bundle in the process shares one queue
const g = globalThis as unknown as { __raceLock?: Promise<unknown> };
function withLedger<T>(fn: (l: Ledger) => T | Promise<T>): Promise<T> {
  const run = (g.__raceLock ?? Promise.resolve()).then(async () => {
    const l = load();
    const out = await fn(l);
    save(l);
    return out;
  });
  g.__raceLock = run.catch(() => {});
  return run;
}

// --- cards ---

type CatchRecord = { assetId: string; name: string; photo: string; spec_key?: string };

async function ownedCard(assetId: string, owner: string) {
  const rpc = heliusRpc();
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "race", method: "getAsset", params: { id: assetId } }),
    cache: "no-store",
  }).then((r) => r.json());
  const asset = res.result;
  if (!asset || asset.burnt || asset.ownership?.owner !== owner) {
    throw new RaceError("card is not in this garage", 403);
  }
  const registry: CatchRecord[] = fs.existsSync(REGISTRY_PATH)
    ? JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"))
    : [];
  const rec = registry.find((c) => c.assetId === assetId);
  const entry = rec?.spec_key ? getEntry(rec.spec_key) : null;
  if (!rec || !entry) throw new RaceError("card has no specs yet — it can't race");
  const car: Car = {
    assetId,
    name: rec.name,
    photo: rec.photo.replace(/^\/catches\//, "/api/photo/"),
    rarity: entry.rarity,
    spec: entry.spec,
  };
  return { car, provisional: entry.status !== "verified" };
}

// deterministic rotation through the room's house cars (no luck)
function houseCar(l: Ledger, rarity: Rarity): Car {
  const pool = houseCars.filter((h) => h.rarity === rarity);
  const list = pool.length ? pool : houseCars;
  const i = l.houseCursor[rarity] ?? 0;
  l.houseCursor[rarity] = i + 1;
  const h = list[i % list.length];
  return { assetId: null, name: h.name, photo: null, rarity: h.rarity as Rarity, spec: h.spec };
}

// --- flows ---

function openFor(e: Entry, now: number) {
  return (
    e.status === "searching" ||
    e.status === "confirming" ||
    (e.status === "awaiting_payment" && now - e.createdAt < PAYMENT_WINDOW_MS)
  );
}

function startRace(l: Ledger, a: Entry, b: Entry | null) {
  const house = b ? null : houseCar(l, a.car.rarity ?? "common");
  const opp = b ? b.car : house!;
  const r = resolve(a.car.spec, opp.spec, a.track);
  const payouts: Payout[] = [];
  if (a.fee > 0) {
    const win = (to: string): Payout => ({ id: randomUUID(), to, lamports: payoutFor(a.fee), kind: "win", status: "pending" });
    const refund = (to: string): Payout => ({ id: randomUUID(), to, lamports: a.fee, kind: "refund", status: "pending" });
    if (r.winner === "a") payouts.push(win(a.owner));
    if (r.winner === "b" && b) payouts.push(win(b.owner));
    // tie: every paying entry back in full, no rake. House win: entry stays
    // (rake + the house's ledger-only stake), nothing to send.
    if (r.winner === "tie") payouts.push(refund(a.owner), ...(b ? [refund(b.owner)] : []));
  }
  const race: Race = {
    id: randomUUID(),
    track: a.track,
    room: a.room,
    fee: a.fee,
    a: a.id,
    b: b?.id ?? null,
    house,
    ...r,
    payouts,
    createdAt: Date.now(),
  };
  l.races[race.id] = race;
  for (const e of [a, b]) {
    if (!e) continue;
    e.status = "matched";
    e.raceId = race.id;
  }
}

// FIFO: the longest-waiting driver on the same ground, from another wallet
function tryMatch(l: Ledger, e: Entry) {
  const rival = Object.values(l.entries)
    .filter(
      (o) =>
        o.id !== e.id &&
        o.status === "searching" &&
        o.track === e.track &&
        o.room === e.room &&
        o.fee === e.fee &&
        o.owner !== e.owner,
    )
    .sort((x, y) => (x.searchingSince ?? 0) - (y.searchingSince ?? 0))[0];
  if (rival) startRace(l, rival, e);
}

export async function createEntry(input: {
  owner: unknown;
  assetId: unknown;
  track: unknown;
  room: unknown;
}) {
  const { assetId, track, room } = input;
  const wallet = (v: unknown): v is string =>
    typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
  // logged-out practice uses the founder catch wallet, like the garage does
  const owner = wallet(input.owner) ? input.owner : room === "practice" ? process.env.CATCH_OWNER : null;
  if (!wallet(owner)) throw new RaceError("log in to race for SOL", 401);
  if (typeof assetId !== "string" || !isTrack(track) || !isRoom(room)) {
    throw new RaceError("assetId, track and room are required");
  }
  const { car, provisional } = await ownedCard(assetId, owner);
  if (room !== "practice") {
    if (car.rarity !== room) throw new RaceError(`this card races in the ${car.rarity} room`);
    // race gate: provisional cards stay out of paid races until their spec
    // settles — RACE_ALLOW_PROVISIONAL lets them in (founder: on for the
    // mainnet launch too, 10-11, with daily review of pending cars)
    if (provisional && process.env.RACE_ALLOW_PROVISIONAL !== "1") {
      throw new RaceError("card specs are not settled yet");
    }
  }
  const fee = feeFor(room);
  const id = randomUUID();
  const issued = fee > 0 ? await buildEntryTx(owner, fee, `rbola race entry ${id}`) : null;

  return withLedger((l) => {
    const now = Date.now();
    if (Object.values(l.entries).some((e) => e.car.assetId === assetId && openFor(e, now))) {
      throw new RaceError("this card is already entered", 409);
    }
    const e: Entry = { id, owner, track, room, fee, car, status: "awaiting_payment", createdAt: now };
    l.entries[id] = e;
    if (!issued) {
      // practice: house car, instant, no SOL
      e.status = "searching";
      e.searchingSince = now;
      startRace(l, e, null);
      return { entry: view(l, e), tx: null };
    }
    e.message = issued.message;
    e.lastValidBlockHeight = issued.lastValidBlockHeight;
    return { entry: view(l, e), tx: issued.tx };
  });
}

// who may confirm/cancel an entry — routes check it against the caller's session
export function entryOwner(id: string): string {
  const e = load().entries[id];
  if (!e) throw new RaceError("entry not found", 404);
  return e.owner;
}

export async function confirmEntry(id: string, signedTx: unknown) {
  if (typeof signedTx !== "string") throw new RaceError("signed transaction required");
  const e0 = await withLedger((l) => {
    const e = l.entries[id];
    if (!e) throw new RaceError("entry not found", 404);
    if (e.status !== "awaiting_payment") throw new RaceError(`entry is ${e.status}`, 409);
    // remember the signature before broadcasting: if the process dies
    // mid-confirm, the tick can still tell whether the payment landed
    const attempt = signatureOf(signedTx, e.message!);
    if (attempt) e.attemptSig = attempt;
    e.status = "confirming";
    e.confirmingSince = Date.now();
    return { ...e };
  });
  let sig: string;
  try {
    sig = await submitEntryTx(signedTx, e0.message!, e0.lastValidBlockHeight!);
  } catch (err) {
    await withLedger((l) => {
      l.entries[id].status = "awaiting_payment";
    });
    throw new RaceError(err instanceof Error ? err.message : String(err), 402);
  }
  const out = await withLedger((l) => markPaid(l, l.entries[id], sig));
  await settle(id);
  return out;
}

function markPaid(l: Ledger, e: Entry, sig: string) {
  e.paySig = sig;
  delete e.attemptSig;
  delete e.confirmingSince;
  e.status = "searching";
  e.searchingSince = Date.now();
  tryMatch(l, e);
  return view(l, e);
}

// paid search that found nobody: full refund
function expire(e: Entry, now: number) {
  if (e.status !== "searching" || e.fee === 0) return;
  if (now - (e.searchingSince ?? 0) < NO_RIVAL_MS) return;
  e.status = "cancelled";
  e.endReason = "no_rival";
  e.refund = { id: randomUUID(), to: e.owner, lamports: e.fee, kind: "refund", status: "pending" };
}

// lost-confirmation entries: adopt the payment if it landed, forget it if it
// provably never will
async function reconcileAttempt(id: string) {
  const e0 = load().entries[id];
  if (!e0?.attemptSig || e0.status !== "awaiting_payment") return "none" as const;
  const st = await txStatus(e0.attemptSig, e0.lastValidBlockHeight!);
  if (st === "pending") return st;
  await withLedger((l) => {
    const e = l.entries[id];
    if (e.status !== "awaiting_payment" || e.attemptSig !== e0.attemptSig) return;
    if (st === "landed") markPaid(l, e, e0.attemptSig!);
    else delete e.attemptSig;
  });
  return st;
}

// Background tick (lib/raceWorker): expiry, lost confirmations, payouts.
export async function tick() {
  const work = await withLedger((l) => {
    const now = Date.now();
    for (const e of Object.values(l.entries)) {
      expire(e, now);
      // a confirm that never finished (process restart mid-broadcast)
      if (e.status === "confirming" && now - (e.confirmingSince ?? e.createdAt) > STALE_CONFIRM_MS) {
        e.status = "awaiting_payment";
      }
    }
    const attempts = Object.values(l.entries)
      .filter((e) => e.status === "awaiting_payment" && e.attemptSig)
      .map((e) => e.id);
    const payable = Object.values(l.entries)
      .filter((e) => pendingPayouts(l, e.id).length > 0)
      .map((e) => e.id);
    return { attempts, payable };
  });
  for (const id of work.attempts) await reconcileAttempt(id).catch(() => {});
  for (const id of work.payable) await settle(id);
}

export async function getEntryView(id: string) {
  await withLedger((l) => {
    const e = l.entries[id];
    if (!e) throw new RaceError("entry not found", 404);
    expire(e, Date.now());
  });
  await settle(id);
  return withLedger((l) => view(l, l.entries[id]));
}

export async function cancelEntry(id: string) {
  // a payment whose confirmation was lost must settle before we can say
  // whether there is anything to refund
  if ((await reconcileAttempt(id)) === "pending") {
    throw new RaceError("payment is still settling — try again in a minute", 409);
  }
  await withLedger((l) => {
    const e = l.entries[id];
    if (!e) throw new RaceError("entry not found", 404);
    if (e.status === "awaiting_payment") {
      e.status = "cancelled"; // nothing was paid
      return;
    }
    if (e.status !== "searching") throw new RaceError(`entry is ${e.status}`, 409);
    e.status = "cancelled";
    e.endReason = "left";
    e.refund = { id: randomUUID(), to: e.owner, lamports: e.fee, kind: "refund", status: "pending" };
  });
  await settle(id);
  return withLedger((l) => view(l, l.entries[id]));
}

// --- payouts ---

const inflight = ((globalThis as unknown as { __racePay?: Set<string> }).__racePay ??=
  new Set<string>());

function pendingPayouts(l: Ledger, entryId: string): Payout[] {
  const e = l.entries[entryId];
  const race = e?.raceId ? l.races[e.raceId] : null;
  return [...(race?.payouts ?? []), ...(e?.refund ? [e.refund] : [])].filter(
    (p) => p.status === "pending",
  );
}

// send every pending payout touching this entry; safe to call repeatedly and
// concurrently (tick + both racers' polls): each payout is re-read under the
// lock once claimed, and its signature only replaced compare-and-set, so a
// stale copy can never sign or broadcast a second transfer
async function settle(entryId: string) {
  const ids = await withLedger((l) => pendingPayouts(l, entryId).map((p) => p.id));
  for (const id of ids) {
    if (inflight.has(id)) continue;
    inflight.add(id);
    try {
      await payOne(entryId, id);
    } catch (err) {
      console.error("race payout failed (will retry on next tick)", err);
    } finally {
      inflight.delete(id);
    }
  }
}

async function payOne(entryId: string, id: string) {
  const match = (q: Payout) => q.id === id;
  const p = await withLedger((l) => {
    const q = pendingPayouts(l, entryId).find(match);
    return q ? { ...q } : null;
  });
  if (!p) return; // already sent by someone else
  // a signature already recorded may have landed — never pay twice
  if (p.sig && p.lastValidBlockHeight) {
    const st = await txStatus(p.sig, p.lastValidBlockHeight);
    if (st === "landed") return mark(entryId, id, p.sig, { status: "sent" });
    if (st === "pending") return;
  }
  // the payout id in the memo makes every payout a distinct transaction (two
  // identical transfers under one blockhash would collapse into one signature)
  const signed = await signPayout(p.to, p.lamports, `rbola race ${p.kind} ${p.id}`);
  // persist the new signature only if nothing changed since the read
  if (!(await mark(entryId, id, p.sig, { ...signed }))) return;
  await broadcastPayout(signed);
  await mark(entryId, id, signed.sig, { status: "sent" });
}

// compare-and-set on (payout id, current sig); true if it patched
function mark(entryId: string, id: string, expectSig: string | undefined, patch: Partial<Payout>) {
  return withLedger((l) => {
    const q = pendingPayouts(l, entryId).find((x) => x.id === id);
    if (!q || q.sig !== expectSig) return false;
    Object.assign(q, patch);
    return true;
  });
}

// --- client view (opponent's car stays hidden until matched) ---

function view(l: Ledger, e: Entry) {
  const race = e.raceId ? l.races[e.raceId] : null;
  const mine = race?.a === e.id ? "a" : "b";
  const oppEntry = race ? (mine === "a" ? (race.b ? l.entries[race.b] : null) : l.entries[race.a]) : null;
  const oppCar = race ? (oppEntry?.car ?? race.house) : null;
  const myPayout = race?.payouts.find((p) => p.to === e.owner) ?? e.refund ?? null;
  return {
    id: e.id,
    status: e.status,
    track: e.track,
    room: e.room,
    fee: e.fee,
    car: { assetId: e.car.assetId, name: e.car.name, photo: e.car.photo, rarity: e.car.rarity },
    reason: e.endReason ?? null,
    paySig: e.paySig ?? null,
    opponent: oppCar
      ? {
          name: oppCar.name,
          photo: oppCar.photo,
          rarity: oppCar.rarity,
          driver: oppEntry ? `${oppEntry.owner.slice(0, 4)}…${oppEntry.owner.slice(-4)}` : "HOUSE",
        }
      : null,
    result: race
      ? {
          outcome: race.winner === "tie" ? "tie" : race.winner === mine ? "win" : "loss",
          score: mine === "a" ? race.scoreA : race.scoreB,
          opponentScore: mine === "a" ? race.scoreB : race.scoreA,
        }
      : null,
    payout: myPayout
      ? { kind: myPayout.kind, lamports: myPayout.lamports, status: myPayout.status, sig: myPayout.status === "sent" ? myPayout.sig : null }
      : null,
  };
}

// --- per-wallet stats (read-only: never takes the lock, never saves) ---

export type RaceActivity = {
  raceId: string;
  at: number; // ms epoch
  track: Track;
  room: Room;
  practice: boolean;
  car: string;
  opponent: string; // opponent car name
  house: boolean;
  fee: number; // lamports paid in (0 = practice)
  outcome: "win" | "loss" | "tie";
  lamports: number; // net SOL delta for this wallet (entry out, payout in)
  payoutSig: string | null; // landed payout / refund transfer, if any
};

export function raceStats(owner: string, recent = 10) {
  const l = load(); // atomic rename on save → always a whole file
  const rows: RaceActivity[] = [];
  for (const race of Object.values(l.races)) {
    for (const side of ["a", "b"] as const) {
      const id = side === "a" ? race.a : race.b;
      const e = id ? l.entries[id] : null;
      if (!e || e.owner !== owner) continue;
      const oppEntry = side === "a" ? (race.b ? l.entries[race.b] : null) : l.entries[race.a];
      const mine = race.payouts.filter((p) => p.to === owner);
      const received = mine.reduce((s, p) => s + p.lamports, 0);
      rows.push({
        raceId: race.id,
        at: race.createdAt,
        track: race.track,
        room: race.room,
        practice: race.room === "practice",
        car: e.car.name,
        opponent: (oppEntry?.car ?? race.house)?.name ?? "",
        house: !oppEntry,
        fee: race.fee,
        outcome: race.winner === "tie" ? "tie" : race.winner === side ? "win" : "loss",
        lamports: received - race.fee,
        payoutSig: mine.find((p) => p.status === "sent" && p.sig)?.sig ?? null,
      });
    }
  }
  rows.sort((x, y) => y.at - x.at);

  const paid = rows.filter((r) => !r.practice);
  const wins = paid.filter((r) => r.outcome === "win").length;
  const losses = paid.filter((r) => r.outcome === "loss").length;
  const ties = paid.length - wins - losses;
  let streak = 0; // current run of paid wins, newest first
  for (const r of paid) {
    if (r.outcome !== "win") break;
    streak++;
  }
  const practice = rows.length - paid.length;
  return {
    races: paid.length,
    wins,
    losses,
    ties,
    winRate: paid.length ? wins / paid.length : null,
    streak,
    // gross winner's take received (net of own entry = netLamports)
    wonLamports: paid.reduce((s, r) => s + (r.outcome === "win" ? r.lamports + r.fee : 0), 0),
    netLamports: paid.reduce((s, r) => s + r.lamports, 0),
    practice: {
      races: practice,
      wins: rows.filter((r) => r.practice && r.outcome === "win").length,
    },
    recent: rows.slice(0, recent),
  };
}
