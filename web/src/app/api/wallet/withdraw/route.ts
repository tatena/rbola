import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { AuthError, authError, callerWallet } from "@/lib/auth";
import { buildWithdrawTx } from "@/lib/raceWallet";

// POST {owner, to, lamports} → the unsigned transfer from the caller's own
// wallet; their wallet signs and sends it (ME → WITHDRAW).
export async function POST(req: Request) {
  try {
    const { owner, to, lamports } = await req.json();
    const from = await callerWallet(req, owner);
    let dest: PublicKey;
    try {
      dest = new PublicKey(String(to));
    } catch {
      return NextResponse.json({ error: "that isn't a Solana address" }, { status: 400 });
    }
    if (dest.toBase58() === from) {
      return NextResponse.json({ error: "that's this wallet" }, { status: 400 });
    }
    if (!Number.isSafeInteger(lamports) || lamports <= 0) {
      return NextResponse.json({ error: "enter an amount" }, { status: 400 });
    }
    return NextResponse.json({ tx: await buildWithdrawTx(from, dest.toBase58(), lamports) });
  } catch (err) {
    if (err instanceof AuthError) return authError(err);
    console.error("withdraw", err);
    return NextResponse.json({ error: "couldn't build the transfer" }, { status: 500 });
  }
}
