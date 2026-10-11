import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CATCHES_DIR, REGISTRY_PATH, writeJsonAtomic } from "@/lib/dataDir";
import { txStatus } from "@/lib/raceWallet";
import { APP_URL, CLUSTER, heliusRpc } from "@/lib/cluster";
import { NextRequest, NextResponse } from "next/server";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplBubblegum,
  mintV2,
  parseLeafFromMintV2Transaction,
} from "@metaplex-foundation/mpl-bubblegum";
import { keypairIdentity, none, publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { AuthError, authEnabled, authError, callerWallet, hasBearer } from "@/lib/auth";
import { allow, clientIp } from "@/lib/rateLimit";
import {
  MAX_PHOTO_B64_CHARS,
  evaluateVerdict,
  photoSha256,
  readVerificationToken,
  verdictName,
  type VerifiedCatch,
} from "@/lib/verifyCatch";

// the card tree: MERKLE_TREE per network; devnet falls back to the spike tree
const TREE =
  process.env.MERKLE_TREE ??
  (CLUSTER === "devnet" ? "7hZ1FXsYbFWon6rxrJydouX5dcsATMSFejsnNR4My41u" : undefined);

// exact-photo hashes being minted right now; with the registry check below
// this makes every verified photo mint exactly once, ever (the verify token
// alone is reusable for its 10-minute life)
const minting = ((globalThis as unknown as { __minting?: Set<string> }).__minting ??=
  new Set<string>());

function readRegistry(): Record<string, unknown>[] {
  return fs.existsSync(REGISTRY_PATH) ? JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) : [];
}

// only these shapes reach the registry + metadata: anything else is dropped,
// so a request can't bloat the files every garage read parses
const finite = (v: unknown) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const coord = (v: unknown, max: number) => {
  const n = finite(v);
  return n !== null && Math.abs(n) <= max ? n : null;
};
function cleanFrame(f: unknown) {
  if (!f || typeof f !== "object") return null;
  const r = f as Record<string, unknown>;
  const [x, y, width, height] = ["x", "y", "width", "height"].map((k) => finite(r[k]));
  return x !== null && y !== null && width !== null && height !== null ? { x, y, width, height } : null;
}

export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > 9_000_000) {
    return NextResponse.json({ error: "photo too large" }, { status: 413 });
  }
  // cheap rejections before reading a multi-MB body
  if (authEnabled && !hasBearer(req)) {
    return NextResponse.json({ error: "log in first" }, { status: 401 });
  }
  if (!allow(`catch:pre:${clientIp(req)}`, 60, 3600_000)) {
    return NextResponse.json({ error: "too many catches — try again later" }, { status: 429 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const { photo, owner, verification } = body;
  const lat = coord(body.lat, 90);
  const lon = coord(body.lon, 180);
  const frame = cleanFrame(body.frame);
  if (!photo) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
  }
  const b64 = String(photo).replace(/^data:image\/\w+;base64,/, "");
  if (b64.length > MAX_PHOTO_B64_CHARS) {
    return NextResponse.json({ error: "photo too large" }, { status: 413 });
  }

  // mint to the logged-in caller's own wallet — the posted owner is only a
  // claim checked against their Privy session. The founder-wallet fallback
  // exists only for dev builds without auth configured.
  let leafOwner: string;
  if (authEnabled) {
    try {
      leafOwner = await callerWallet(req, owner);
    } catch (e) {
      if (e instanceof AuthError) return authError(e);
      throw e;
    }
  } else {
    const validOwner =
      typeof owner === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner);
    leafOwner = validOwner ? owner : process.env.CATCH_OWNER!;
  }

  // every mint is paid by the server payer — cap it per wallet and network
  if (
    !allow(`catch:${leafOwner}`, 20, 3600_000) ||
    !allow(`catch:day:${leafOwner}`, 60, 24 * 3600_000) ||
    !allow(`catch:ip:${clientIp(req)}`, 40, 3600_000) ||
    !allow("catch:all", 500, 24 * 3600_000)
  ) {
    return NextResponse.json(
      { error: "too many catches — try again later" },
      { status: 429 },
    );
  }

  // mint only verified catches: the /api/verify verdict arrives as a signed
  // token bound to this exact photo, so the gate can't be skipped or replayed
  // onto a different image
  const photoHash = photoSha256(b64);
  const verified =
    typeof verification === "string"
      ? readVerificationToken(verification, photoHash)
      : null;
  // defense in depth: a valid signature alone isn't enough — the embedded
  // verdict must also pass the gate rule. The code tells the client a fresh
  // verify can fix this (expired token), unlike an auth error.
  if (!verified || !evaluateVerdict(verified.verdict).passed) {
    return NextResponse.json(
      { error: "catch is not verified", code: "token_invalid" },
      { status: 403 },
    );
  }

  // claim the photo: check + reserve run synchronously, so two concurrent
  // posts of the same photo can't both pass
  if (minting.has(photoHash)) {
    return NextResponse.json({ error: "this photo is minting" }, { status: 409 });
  }
  const prior = readRegistry().find((r) => r.photoSha256 === photoHash);
  if (prior?.assetId) {
    return NextResponse.json({ error: "this photo is already minted" }, { status: 409 });
  }
  minting.add(photoHash);
  try {
    // a mint whose outcome was unknown settles first — never a second card
    if (prior) {
      const settled = await settleMint(prior);
      if (settled.assetId) return NextResponse.json({ assetId: settled.assetId });
      if (settled.pending) {
        return NextResponse.json({ error: "still minting — try again in a minute" }, { status: 409 });
      }
    }
    return await mint({ b64, photoHash, lat, lon, frame, leafOwner, ...verified });
  } finally {
    minting.delete(photoHash);
  }
}

type RegistryRecord = Record<string, unknown> & {
  photoSha256?: string;
  assetId?: string | null;
  mintSig?: string;
  lastValidBlockHeight?: number;
  photo?: string;
};

// AI-written names reach the permanent on-chain name and public metadata:
// letters, digits and a little punctuation only, bounded length
function cleanText(v: unknown, max = 48): string {
  return String(v ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} .\-&'/+]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Bubblegum caps the on-chain name at 32 BYTES (UTF-8), not characters
function onchainName(name: string): string {
  let out = `RBOLA · ${name}`;
  while (Buffer.byteLength(out, "utf8") > 32) out = Array.from(out).slice(0, -1).join("");
  return out.trimEnd();
}

function umiClient() {
  const umi = createUmi(heliusRpc(), { fetch: timedFetch }).use(mplBubblegum());
  const secret = new Uint8Array(
    JSON.parse(fs.readFileSync(process.env.PAYER_KEYPAIR_PATH!, "utf8")),
  );
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));
  return umi;
}

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });

function updateRecord(photoHash: string, patch: Partial<RegistryRecord> | null) {
  // read + modify + write with no await in between (single process)
  const index = readRegistry() as RegistryRecord[];
  const i = index.findIndex((r) => r.photoSha256 === photoHash);
  if (i < 0) return;
  if (patch === null) index.splice(i, 1);
  else index[i] = { ...index[i], ...patch };
  writeJsonAtomic(REGISTRY_PATH, index);
}

async function leafOf(umi: ReturnType<typeof umiClient>, sig: Uint8Array) {
  // the node needs a moment to index the tx before it can be parsed
  for (let attempt = 0; ; attempt++) {
    try {
      return await parseLeafFromMintV2Transaction(umi, sig);
    } catch (e) {
      if (attempt >= 12) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// A record saved before broadcast whose outcome we never learned: landed →
// finish it; provably dropped → forget it (and its files) so the photo can
// mint; otherwise still pending.
async function settleMint(rec: RegistryRecord): Promise<{ assetId?: string; pending?: boolean }> {
  if (!rec.mintSig || !rec.lastValidBlockHeight) {
    updateRecord(rec.photoSha256!, null);
    return {};
  }
  const st = await txStatus(rec.mintSig, rec.lastValidBlockHeight);
  if (st === "pending") return { pending: true };
  if (st === "dropped") {
    updateRecord(rec.photoSha256!, null);
    const id = String(rec.photo ?? "").replace(/^\/catches\/|\.jpg$/g, "");
    for (const ext of ["jpg", "json"]) fs.rmSync(path.join(CATCHES_DIR, `${id}.${ext}`), { force: true });
    return {};
  }
  const umi = umiClient();
  const leaf = await leafOf(umi, base58.serialize(rec.mintSig));
  updateRecord(rec.photoSha256!, { assetId: leaf.id, status: undefined });
  return { assetId: leaf.id };
}

async function mint({
  b64,
  photoHash,
  lat,
  lon,
  frame,
  leafOwner,
  verdict,
  resolution,
}: {
  b64: string;
  photoHash: string;
  lat: number | null;
  lon: number | null;
  frame: { x: number; y: number; width: number; height: number } | null;
  leafOwner: string;
} & VerifiedCatch) {
  const name = cleanText(verdictName(verdict)) || "Unidentified car";
  if (!TREE) throw new Error("MERKLE_TREE is not set");

  // photo + metadata live on our server's disk, served from our own domain
  // (/api/photo, /api/meta) — the on-chain uri is permanent, and owning the
  // domain lets us move the files (e.g. to Arweave) later without breaking it
  const id = crypto.randomBytes(8).toString("hex");
  const image = `${APP_URL}/api/photo/${id}.jpg`;
  // public metadata gets the spot to ~1 km: exact GPS of a catch is often
  // someone's street; the registry below keeps the exact fix for verification
  const coarse = (v: number | null) => (v === null ? "" : v.toFixed(2));
  const dir = CATCHES_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jpg`), Buffer.from(b64, "base64"));
  writeJsonAtomic(path.join(dir, `${id}.json`), {
    name: `RBOLA · ${name}`,
    symbol: "RBOLA",
    description: `${name}, spotted on the street and verified. Caught with RBOLA.`,
    image,
    external_url: "https://rbola.fun",
    properties: { category: "image", files: [{ uri: image, type: "image/jpeg" }] },
    attributes: [
      { trait_type: "lat", value: coarse(lat) },
      { trait_type: "lon", value: coarse(lon) },
      { trait_type: "caught_at", value: new Date().toISOString() },
      // card-frame crop (photo px) — card rendering uses this region
      { trait_type: "card_frame", value: frame ? JSON.stringify(frame) : "" },
      // AI verification verdict (gate v0)
      { trait_type: "make", value: cleanText(verdict.make) },
      { trait_type: "model", value: cleanText(verdict.model) },
      { trait_type: "generation", value: cleanText(verdict.generation_or_trim) },
      { trait_type: "verify_confidence", value: verdict.confidence },
      // catalog provenance — provisional cards settle on founder review
      { trait_type: "spec_key", value: resolution.spec_key },
      { trait_type: "catalog", value: resolution.catalog_version },
      { trait_type: "rarity", value: resolution.rarity },
    ],
  });

  const umi = umiClient();
  const blockhash = await umi.rpc.getLatestBlockhash();
  const tx = await mintV2(umi, {
    leafOwner: publicKey(leafOwner),
    merkleTree: publicKey(TREE),
    metadata: {
      name: onchainName(name),
      symbol: "RBOLA",
      uri: `${APP_URL}/api/meta/${id}`,
      sellerFeeBasisPoints: 0, // no creators to receive royalties
      collection: none(),
      creators: [],
    },
  })
    .setBlockhash(blockhash)
    .buildAndSign(umi);
  const sig = tx.signatures[0];
  const mintSig = base58.deserialize(sig)[0];

  // the record (with its signature) is saved BEFORE broadcast: if anything
  // below fails, a retry settles this mint instead of minting a second card
  const index = readRegistry();
  index.push({
    assetId: null,
    status: "minting",
    mintSig,
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
    photo: `/catches/${id}.jpg`,
    photoSha256: photoHash,
    name,
    lat,
    lon,
    frame,
    time: new Date().toISOString(),
    verification: {
      generation: cleanText(verdict.generation_or_trim),
      confidence: verdict.confidence,
    },
    spec_key: resolution.spec_key,
    rarity: resolution.rarity,
    provisional: resolution.provisional,
    catalog_version: resolution.catalog_version,
  });
  writeJsonAtomic(REGISTRY_PATH, index);

  try {
    await umi.rpc.sendTransaction(tx);
    await umi.rpc.confirmTransaction(sig, { strategy: { type: "blockhash", ...blockhash } });
    const leaf = await leafOf(umi, sig);
    updateRecord(photoHash, { assetId: leaf.id, status: undefined });
    return NextResponse.json({ assetId: leaf.id });
  } catch (err) {
    console.error("mint unconfirmed (a retry will settle it)", err);
    return NextResponse.json(
      { error: "mint is settling — try again in a minute" },
      { status: 503 },
    );
  }
}
