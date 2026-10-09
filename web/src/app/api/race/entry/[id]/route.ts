import { NextResponse } from "next/server";
import { getEntryView, raceError } from "@/lib/raceLedger";

// GET → polled by the client: searching → matched (opponent revealed) → result
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getEntryView((await params).id));
  } catch (err) {
    return raceError(err);
  }
}
