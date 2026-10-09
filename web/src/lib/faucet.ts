import fs from "node:fs";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { STATE_DIR } from "@/lib/dataDir";
import { connection } from "@/lib/raceWallet";

// Devnet starter SOL so a new player can enter a race without hunting for a
// faucet. Its own wallet (FAUCET_KEYPAIR_PATH): drips never touch mint gas or
// race pots. One drip per wallet, ever, and only to near-empty wallets.
const DRIP_LAMPORTS = Number(process.env.FAUCET_LAMPORTS ?? 50_000_000); // 0.05 SOL
const EMPTY_BELOW = 20_000_000; // 0.02 SOL
const LOG_PATH = path.join(STATE_DIR, "faucet.json");

let kp: Keypair | null = null;
function faucetKeypair(): Keypair | null {
  const p = process.env.FAUCET_KEYPAIR_PATH;
  if (!p) return null;
  kp ??= Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  return kp;
}

function readLog(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
  } catch {
    return {};
  }
}

// serialize drips so two tabs can't both pass the "never dripped" check
let queue: Promise<unknown> = Promise.resolve();

export function drip(owner: string, allowSend: () => boolean): Promise<{ sent: boolean; reason?: string; sig?: string }> {
  const run = queue.then(async () => {
    const faucet = faucetKeypair();
    if (!faucet) return { sent: false, reason: "faucet not configured" };
    const log = readLog();
    if (log[owner]) return { sent: false, reason: "already dripped" };
    const to = new PublicKey(owner);
    const conn = connection();
    if ((await conn.getBalance(to)) >= EMPTY_BELOW) {
      return { sent: false, reason: "wallet funded" };
    }
    if ((await conn.getBalance(faucet.publicKey)) < DRIP_LAMPORTS + 10_000) {
      return { sent: false, reason: "faucet empty" };
    }
    if (!allowSend()) return { sent: false, reason: "rate limited" };
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: to, lamports: DRIP_LAMPORTS }),
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [faucet], { commitment: "confirmed" });
    log[owner] = new Date().toISOString();
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 1));
    return { sent: true, sig };
  });
  queue = run.catch(() => {});
  return run;
}
