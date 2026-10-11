import { NextResponse } from "next/server";
import { getEntryView, raceError } from "@/lib/raceLedger";
import { allow, clientIp } from "@/lib/rateLimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// GET → polled by the client: searching → matched (opponent revealed) → result
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "entry not found" }, { status: 404 });
  // a client polls every 1.5s (40/min); more than that is a flood on the lock
  if (!allow(`race:get:${clientIp(req)}`, 240, 60_000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  try {
    return NextResponse.json(await getEntryView(id));
  } catch (err) {
    return raceError(err);
  }
}
