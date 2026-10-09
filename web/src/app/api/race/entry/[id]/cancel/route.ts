import { NextResponse } from "next/server";
import { cancelEntry, raceError } from "@/lib/raceLedger";

// POST → leave the queue while searching; entry refunded in full
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await cancelEntry((await params).id));
  } catch (err) {
    return raceError(err);
  }
}
