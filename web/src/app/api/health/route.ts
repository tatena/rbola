import fs from "node:fs";
import { NextResponse } from "next/server";
import { REGISTRY_PATH } from "@/lib/dataDir";
import { ledgerHealth } from "@/lib/raceLedger";
import { allow, clientIp } from "@/lib/rateLimit";

// Health for the server monitor (deploy/monitor.sh): data files parse, the
// race worker is ticking, no payout or mint is stuck. Counts only — nothing
// identifying.
const STUCK_PAYOUT_S = 15 * 60;
const STUCK_MINT_MS = 10 * 60_000;

export async function GET(req: Request) {
  if (!allow(`health:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  const problems: string[] = [];
  let race = null;
  try {
    race = ledgerHealth();
    if (race.oldestPendingS > STUCK_PAYOUT_S) problems.push("payout stuck");
  } catch {
    problems.push("race ledger unreadable");
  }
  let stuckMints = 0;
  try {
    const index: { assetId?: string | null; time?: string }[] = fs.existsSync(REGISTRY_PATH)
      ? JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"))
      : [];
    stuckMints = index.filter(
      (r) => !r.assetId && Date.now() - new Date(r.time ?? 0).getTime() > STUCK_MINT_MS,
    ).length;
    if (stuckMints > 0) problems.push("mint unsettled");
  } catch {
    problems.push("catch registry unreadable");
  }
  const last = (globalThis as unknown as { __raceLastTick?: number }).__raceLastTick;
  const tickAgeS = last ? Math.round((Date.now() - last) / 1000) : null;
  if (process.env.RACE_KEYPAIR_PATH && (tickAgeS === null ? process.uptime() > 120 : tickAgeS > 120)) {
    problems.push("race worker not ticking");
  }
  return NextResponse.json(
    { ok: problems.length === 0, problems, race, stuckMints, tickAgeS },
    { status: problems.length ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
