import { NextResponse } from "next/server";
import { allow, clientIp } from "@/lib/rateLimit";
import { authEnabled, callerWallet } from "@/lib/auth";
import { cancelEntry, entryOwner, raceError } from "@/lib/raceLedger";

// POST → leave the queue while searching; entry refunded in full
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!allow(`race:cancel:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  try {
    const { id } = await params;
    // only the entry's own player (403 for anyone else's session)
    if (authEnabled) await callerWallet(req, entryOwner(id));
    return NextResponse.json(await cancelEntry(id));
  } catch (err) {
    return raceError(err);
  }
}
