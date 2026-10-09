import { NextResponse } from "next/server";
import { raceError, raceStats } from "@/lib/raceLedger";

// GET ?owner=<wallet> → read-only race record for the profile: paid races
// (wins / losses / ties, win rate, streak, SOL won + net), practice counted
// apart, and the most recent races (paid + practice) for the activity list.
// Same owner rule as /api/garage: the founder-wallet fallback is dev-only.
export async function GET(req: Request) {
  const qOwner = new URL(req.url).searchParams.get("owner");
  const valid = !!qOwner && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(qOwner);
  const owner = valid ? qOwner : process.env.NEXT_PUBLIC_PRIVY_APP_ID ? null : process.env.CATCH_OWNER;
  try {
    if (!owner) return NextResponse.json(raceStats("", 0));
    return NextResponse.json(raceStats(owner));
  } catch (err) {
    return raceError(err);
  }
}
