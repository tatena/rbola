// Race wallet — the server keypair that holds pots (separate from the mint
// payer: pots never mix with gas money). Entries are SOL transfers player →
// race wallet; payouts/refunds are transfers race wallet → player. Every
// movement is a real devnet transaction. Never put RACE_KEYPAIR_PATH in Vercel.

import fs from "node:fs";
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
  conn ??= new Connection(
    `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    "confirmed",
  );
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

// "landed" | "pending" (may still land) | "dropped" (blockhash expired, never landed)
export async function txStatus(sig: string, lastValidBlockHeight: number) {
  const { value } = await connection().getSignatureStatuses([sig], {
    searchTransactionHistory: true,
  });
  const st = value[0];
  if (st && !st.err && st.confirmationStatus) return "landed";
  if (st?.err) return "dropped";
  const height = await connection().getBlockHeight("confirmed");
  return height > lastValidBlockHeight ? "dropped" : "pending";
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
