// Server-side caller identity. Routes that mint, move SOL or touch a race
// entry must not trust the `owner` the browser posts — the client sends its
// Privy access token, we verify it (ES256 JWT, Privy's verification key) and
// accept the claimed wallet only if it is one of that user's Solana wallets.

import { NextResponse } from "next/server";
import { importSPKI, jwtVerify, type KeyLike } from "jose";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 | 500,
  ) {
    super(message);
  }
}

export function authError(err: AuthError) {
  return NextResponse.json({ error: err.message }, { status: err.status });
}

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
// dev builds without Privy keep the founder-wallet fallback in each route
export const authEnabled = !!APP_ID;

let key: Promise<KeyLike> | null = null;
function verificationKey(): Promise<KeyLike> {
  // env files are one line per var and get read by both bash and systemd, so
  // accept the key in any shape — full PEM, "\n"-escaped, or just its base64
  // body — and rebuild a clean PEM from the body
  const body = (process.env.PRIVY_VERIFICATION_KEY ?? "")
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\\n|\s/g, "");
  if (!body) throw new AuthError("auth is not configured", 500);
  key ??= importSPKI(
    `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`,
    "ES256",
  ).catch((e) => {
    key = null; // a bad key value must not stick after the env is fixed
    throw e;
  });
  return key;
}

export function hasBearer(req: Request): boolean {
  return /^Bearer .+/.test(req.headers.get("authorization") ?? "");
}

// → the Privy user id (DID) behind the request's access token
async function callerId(req: Request): Promise<string> {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AuthError("log in first", 401);
  const k = await verificationKey();
  try {
    const { payload } = await jwtVerify(token, k, { issuer: "privy.io", audience: APP_ID });
    if (!payload.sub) throw new Error("no subject");
    return payload.sub;
  } catch {
    throw new AuthError("session expired — log in again", 401);
  }
}

// user id → their Solana wallet addresses, cached briefly; a miss on the
// claimed wallet refetches (the embedded wallet appears just after first login)
const WALLETS_TTL_MS = 5 * 60_000;
const walletCache = new Map<string, { at: number; wallets: string[] }>();

async function fetchWallets(userId: string): Promise<string[]> {
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) throw new AuthError("auth is not configured", 500);
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${APP_ID}:${secret}`).toString("base64")}`,
      "privy-app-id": APP_ID!,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("privy user lookup failed", res.status);
    throw new AuthError("could not check your session — try again", 500);
  }
  const user = (await res.json()) as {
    linked_accounts?: { type?: string; chain_type?: string; address?: string }[];
  };
  const wallets = (user.linked_accounts ?? [])
    .filter((a) => a.type === "wallet" && a.chain_type === "solana" && a.address)
    .map((a) => a.address!);
  walletCache.set(userId, { at: Date.now(), wallets });
  return wallets;
}

// The wallet this request may act for: the claimed one if it belongs to the
// logged-in caller, else their first Solana wallet. 401 without a valid
// session, 403 for someone else's wallet.
export async function callerWallet(req: Request, claimed: unknown): Promise<string> {
  const userId = await callerId(req);
  const cached = walletCache.get(userId);
  const fresh = !!cached && Date.now() - cached.at < WALLETS_TTL_MS;
  let wallets = fresh ? cached.wallets : await fetchWallets(userId);
  const hasClaim = typeof claimed === "string" && claimed !== "";
  if (hasClaim && fresh && !wallets.includes(claimed)) wallets = await fetchWallets(userId);
  if (hasClaim) {
    if (!wallets.includes(claimed)) throw new AuthError("that wallet is not yours", 403);
    return claimed;
  }
  if (!wallets[0]) throw new AuthError("wallet not ready — try again", 401);
  return wallets[0];
}
