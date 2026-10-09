import { NextRequest, NextResponse } from "next/server";
import { drip } from "@/lib/faucet";
import { allow, clientIp } from "@/lib/rateLimit";

// POST {owner} — starter devnet SOL for a new player (see lib/faucet.ts)
export async function POST(req: NextRequest) {
  let owner: unknown;
  try {
    ({ owner } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (typeof owner !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) {
    return NextResponse.json({ error: "owner is required" }, { status: 400 });
  }
  // fresh emails are free to make — cap actual drips per network per day
  const ip = clientIp(req);
  try {
    return NextResponse.json(await drip(owner, () => allow(`faucet:${ip}`, 10, 24 * 3600_000)));
  } catch (e) {
    console.error("faucet drip failed", e);
    return NextResponse.json({ sent: false, reason: "drip failed" }, { status: 502 });
  }
}
