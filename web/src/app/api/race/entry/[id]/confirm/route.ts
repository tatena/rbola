import { NextResponse } from "next/server";
import { confirmEntry, raceError } from "@/lib/raceLedger";

// POST {signedTx} → broadcasts the player-signed entry transfer, then joins the queue
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { signedTx } = await req.json();
    return NextResponse.json(await confirmEntry((await params).id, signedTx));
  } catch (err) {
    return raceError(err);
  }
}
