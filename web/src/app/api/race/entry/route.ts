import { NextResponse } from "next/server";
import { authEnabled, callerWallet, hasBearer } from "@/lib/auth";
import { createEntry, raceError } from "@/lib/raceLedger";
import { allow, clientIp } from "@/lib/rateLimit";

// POST {owner, assetId, track, room} → entry + the unsigned entry transfer
// (base64) for the player's wallet to sign. Practice returns the result.
// The wallet comes from the caller's session; logged out = practice only.
export async function POST(req: Request) {
  if (!allow(`race:new:${clientIp(req)}`, 20, 60_000) || !allow(`race:newh:${clientIp(req)}`, 200, 3600_000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  try {
    const body = await req.json();
    if (authEnabled) body.owner = hasBearer(req) ? await callerWallet(req, body.owner) : null;
    return NextResponse.json(await createEntry(body));
  } catch (err) {
    return raceError(err);
  }
}
