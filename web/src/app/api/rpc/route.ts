import { NextResponse } from "next/server";
import { heliusRpc } from "@/lib/cluster";
import { allow, clientIp } from "@/lib/rateLimit";

// Browser → Solana JSON-RPC, forwarded with the server's Helius key so no RPC
// key ever ships to phones (Helius credits are per account: a leaked browser
// key could starve minting). Only the calls an embedded wallet needs to sign
// and send a transfer, rate-limited per IP.
const METHODS = new Set([
  "getLatestBlockhash",
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getTransaction",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getGenesisHash",
  "isBlockhashValid",
  "simulateTransaction",
  "sendTransaction",
]);

type Call = { method?: unknown };

export async function POST(req: Request) {
  if (!allow(`rpc:${clientIp(req)}`, 60, 60_000) || !allow("rpc:all", 30_000, 24 * 3600_000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  let body: Call | Call[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 3 || !calls.every((c) => METHODS.has(String(c?.method)))) {
    return NextResponse.json({ error: "method not allowed" }, { status: 403 });
  }
  const res = await fetch(heliusRpc(), {
    signal: AbortSignal.timeout(20_000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
