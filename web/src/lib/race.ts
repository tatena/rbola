// Race core — pure, deterministic, no I/O (race logic LOCKED 2026-10-06,
// rarity rooms 2026-10-08; spec in tasks/race-logic.md). One leg, one track:
// score = terrain-weighted sum of deriveStats(spec); higher score takes the pot.
// No luck, no wear, no upgrades. Integer math so exact ties are real ties.

import type { Rarity, Spec } from "@/lib/catalog";
import { deriveStats } from "@/lib/catalog";

export const TRACKS = ["MOUNTAIN PASS", "HIGHWAY RUN", "DRAG STRIP"] as const;
export type Track = (typeof TRACKS)[number];

// terrain table v0, in tenths: SPEED · ACCEL · HANDLING
const WEIGHTS: Record<Track, { speed: number; accel: number; handling: number }> = {
  "MOUNTAIN PASS": { speed: 2, accel: 3, handling: 5 },
  "HIGHWAY RUN": { speed: 5, accel: 3, handling: 2 },
  "DRAG STRIP": { speed: 3, accel: 6, handling: 1 },
};

export const ROOMS: Rarity[] = ["common", "scarce", "rare", "epic", "legendary"];

// v0 demo fee ladder (real amounts = open founder economy decision)
export const FEE_LAMPORTS: Record<Rarity, number> = {
  common: 10_000_000, // 0.01 SOL
  scarce: 20_000_000, // 0.02
  rare: 50_000_000, // 0.05
  epic: 100_000_000, // 0.10
  legendary: 250_000_000, // 0.25
};

export const RAKE_PCT = 15;

// "practice" = free room: house car, instant, no SOL, any card
export type Room = Rarity | "practice";

export function isTrack(v: unknown): v is Track {
  return typeof v === "string" && (TRACKS as readonly string[]).includes(v);
}

export function isRoom(v: unknown): v is Room {
  return v === "practice" || (typeof v === "string" && (ROOMS as string[]).includes(v));
}

export function feeFor(room: Room): number {
  return room === "practice" ? 0 : FEE_LAMPORTS[room];
}

export function score(spec: Spec, track: Track): number {
  const s = deriveStats(spec);
  const w = WEIGHTS[track];
  return s.speed * w.speed + s.accel * w.accel + s.handling * w.handling;
}

export type Outcome = "a" | "b" | "tie";

export function resolve(a: Spec, b: Spec, track: Track) {
  const sa = score(a, track);
  const sb = score(b, track);
  const winner: Outcome = sa === sb ? "tie" : sa > sb ? "a" : "b";
  return { scoreA: sa, scoreB: sb, winner };
}

// winner's take: two equal entries minus rake (floored — dust stays as rake)
export function payoutFor(fee: number): number {
  return Math.floor((fee * 2 * (100 - RAKE_PCT)) / 100);
}
