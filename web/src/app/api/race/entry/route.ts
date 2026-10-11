import { NextResponse } from "next/server";
import { authEnabled, callerWallet, hasBearer } from "@/lib/auth";
import { createEntry, raceError } from "@/lib/raceLedger";

// POST {owner, assetId, track, room} → entry + the unsigned entry transfer
// (base64) for the player's wallet to sign. Practice returns the result.
// The wallet comes from the caller's session; logged out = practice only.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (authEnabled) body.owner = hasBearer(req) ? await callerWallet(req, body.owner) : null;
    return NextResponse.json(await createEntry(body));
  } catch (err) {
    return raceError(err);
  }
}
