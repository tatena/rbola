import { NextResponse } from "next/server";
import { authEnabled, callerWallet } from "@/lib/auth";
import { confirmEntry, entryOwner, raceError } from "@/lib/raceLedger";

// POST {signedTx} → broadcasts the player-signed entry transfer, then joins the queue
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // only the entry's own player (403 for anyone else's session)
    if (authEnabled) await callerWallet(req, entryOwner(id));
    const { signedTx } = await req.json();
    return NextResponse.json(await confirmEntry(id, signedTx));
  } catch (err) {
    return raceError(err);
  }
}
