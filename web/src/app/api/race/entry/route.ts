import { NextResponse } from "next/server";
import { createEntry, raceError } from "@/lib/raceLedger";

// POST {owner, assetId, track, room} → entry + the unsigned entry transfer
// (base64) for the player's wallet to sign. Practice returns the result.
export async function POST(req: Request) {
  try {
    return NextResponse.json(await createEntry(await req.json()));
  } catch (err) {
    return raceError(err);
  }
}
