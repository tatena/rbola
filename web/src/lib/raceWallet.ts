// Race wallet — the server keypair that holds pots (separate from the mint
// payer: pots never mix with gas money). Entries are SOL transfers player →
// race wallet; payouts/refunds are transfers race wallet → player. Every
// movement is a real on-chain transaction. Never put RACE_KEYPAIR_PATH in Vercel.

import fs from "node:fs";
import { heliusRpc } from "@/lib/cluster";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

let conn: Connection | null = null;
export function connection(): Connection {
  // every RPC call times out well inside the race ledger's 3-min stale-confirm
  // window, so a hung provider can't outlive the ledger's assumptions
  conn ??= new Connection(heliusRpc(), {
    commitment: "confirmed",
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
  });
  return conn;
}

let kp: Keypair | null = null;
export function raceKeypair(): Keypair {
  if (!kp) {
    const p = process.env.RACE_KEYPAIR_PATH;
    if (!p) throw new Error("RACE_KEYPAIR_PATH is not set");
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  }
  return kp;
}

function transferTx(from: PublicKey, to: PublicKey, lamports: number, memo: string) {
  return new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }))
    .add(
      new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [],
        data: Buffer.from(memo, "utf8"),
      }),
    );
}

// The server builds the entry transfer; the player's wallet only signs it.
// `message` is kept so the signed transaction can be checked byte-for-byte
// against what was issued (amount, recipient, memo can't be altered).
export async function buildEntryTx(owner: string, lamports: number, memo: string) {
  const { blockhash, lastValidBlockHeight } =
    await connection().getLatestBlockhash("confirmed");
  const payer = new PublicKey(owner);
  const tx = transferTx(payer, raceKeypair().publicKey, lamports, memo);
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;
  return {
    tx: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    message: tx.serializeMessage().toString("base64"),
    lastValidBlockHeight,
  };
}

// A player's own withdrawal: their wallet → any address, built here (server
// RPC) and signed + sent by their wallet. RBOLA never holds these funds.
export async function buildWithdrawTx(owner: string, to: string, lamports: number) {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const payer = new PublicKey(owner);
  const tx = transferTx(payer, new PublicKey(to), lamports, "rbola withdraw");
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;
  return tx.serialize({ requireAllSignatures: false }).toString("base64");
}

// The signature a player-signed entry would land under, if it is the issued
// message with a valid signature (else null: it can never land as an entry).
export function signatureOf(signedB64: string, expectedMessage: string): string | null {
  try {
    const tx = Transaction.from(Buffer.from(signedB64, "base64"));
    if (tx.serializeMessage().toString("base64") !== expectedMessage) return null;
    if (!tx.verifySignatures()) return null;
    return bs58(tx.signature!);
  } catch {
    return null;
  }
}

// Broadcast a player-signed entry transfer after checking it is exactly the
// issued message with a valid signature. Returns the confirmed signature.
export async function submitEntryTx(
  signedB64: string,
  expectedMessage: string,
  lastValidBlockHeight: number,
): Promise<string> {
  const tx = Transaction.from(Buffer.from(signedB64, "base64"));
  if (tx.serializeMessage().toString("base64") !== expectedMessage) {
    throw new Error("signed transaction does not match the issued entry");
  }
  if (!tx.verifySignatures()) throw new Error("transaction is not signed");
  const sig = bs58(tx.signature!);
  try {
    await connection().sendRawTransaction(tx.serialize());
    const res = await connection().confirmTransaction(
      { signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight },
      "confirmed",
    );
    if (res.value.err) throw new Error(`entry transaction failed: ${JSON.stringify(res.value.err)}`);
  } catch (err) {
    // a lost confirmation (or a resend of a landed tx) must not lose the entry
    if ((await txStatus(sig, lastValidBlockHeight)) === "landed") return sig;
    throw err;
  }
  return sig;
}

// Payouts are signed first so the signature can be persisted BEFORE broadcast:
// if confirmation is lost, the next attempt checks that signature instead of
// paying twice.
export async function signPayout(to: string, lamports: number, memo: string) {
  const { blockhash, lastValidBlockHeight } =
    await connection().getLatestBlockhash("confirmed");
  const race = raceKeypair();
  const tx = transferTx(race.publicKey, new PublicKey(to), lamports, memo);
  tx.feePayer = race.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(race);
  return {
    sig: bs58(tx.signature!),
    raw: tx.serialize().toString("base64"),
    blockhash,
    lastValidBlockHeight,
  };
}

export async function broadcastPayout(p: {
  sig: string;
  raw: string;
  blockhash: string;
  lastValidBlockHeight: number;
}) {
  await connection().sendRawTransaction(Buffer.from(p.raw, "base64"));
  const res = await connection().confirmTransaction(
    { signature: p.sig, blockhash: p.blockhash, lastValidBlockHeight: p.lastValidBlockHeight },
    "confirmed",
  );
  if (res.value.err) throw new Error(`payout failed: ${JSON.stringify(res.value.err)}`);
}

// "landed" | "pending" (may still land) | "dropped" (provably never landed).
// Block height is read FIRST (finalized, with a margin), then the status: a
// lagging status node can then only make us wait, never call a landed
// transfer dropped and pay it again.
const DROP_MARGIN = 150; // blocks (~1 min) past lastValidBlockHeight
export async function txStatus(sig: string, lastValidBlockHeight: number) {
  const height = await connection().getBlockHeight("finalized");
  const { value } = await connection().getSignatureStatuses([sig], {
    searchTransactionHistory: true,
  });
  const st = value[0];
  if (st?.err) return "dropped"; // landed but failed: no SOL moved
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
    return "landed";
  }
  if (height <= lastValidBlockHeight + DROP_MARGIN) return "pending";
  // Helius load-balances: before calling a transfer dropped (and paying or
  // refunding again), ask once more by full transaction lookup
  const tx = await connection().getTransaction(sig, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (tx) return tx.meta?.err ? "dropped" : "landed";
  return "dropped";
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(bytes: Uint8Array): string {
  const base = BigInt(58);
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > BigInt(0)) {
    out = B58[Number(n % base)] + out;
    n /= base;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
