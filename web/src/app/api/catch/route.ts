import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CATCHES_DIR, REGISTRY_PATH } from "@/lib/dataDir";
import { NextRequest, NextResponse } from "next/server";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplBubblegum,
  mintV2,
  parseLeafFromMintV2Transaction,
} from "@metaplex-foundation/mpl-bubblegum";
import { keypairIdentity, none, publicKey } from "@metaplex-foundation/umi";
import { AuthError, authEnabled, authError, callerWallet } from "@/lib/auth";
import { allow, clientIp } from "@/lib/rateLimit";
import {
  MAX_PHOTO_B64_CHARS,
  evaluateVerdict,
  photoSha256,
  readVerificationToken,
  verdictName,
  type VerifiedCatch,
} from "@/lib/verifyCatch";

// the spike tree from step 5 — 16k card slots
const TREE = "7hZ1FXsYbFWon6rxrJydouX5dcsATMSFejsnNR4My41u";

// exact-photo hashes being minted right now; with the registry check below
// this makes every verified photo mint exactly once, ever (the verify token
// alone is reusable for its 10-minute life)
const minting = ((globalThis as unknown as { __minting?: Set<string> }).__minting ??=
  new Set<string>());

function readRegistry(): Record<string, unknown>[] {
  return fs.existsSync(REGISTRY_PATH) ? JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) : [];
}

export async function POST(req: NextRequest) {
  const { photo, lat, lon, frame, owner, verification } = await req.json();
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
    !allow(`catch:ip:${clientIp(req)}`, 40, 3600_000)
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
  if (minting.has(photoHash) || readRegistry().some((r) => r.photoSha256 === photoHash)) {
    return NextResponse.json(
      { error: "this photo is already minted" },
      { status: 409 },
    );
  }
  minting.add(photoHash);
  try {
    return await mint({ b64, photoHash, lat, lon, frame, leafOwner, ...verified });
  } finally {
    minting.delete(photoHash);
  }
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
  lat: unknown;
  lon: unknown;
  frame: unknown;
  leafOwner: string;
} & VerifiedCatch) {
  const name = verdictName(verdict);

  // v0: photos live on the dev server's disk; real hosting (Irys) comes later
  const id = crypto.randomBytes(8).toString("hex");
  const dir = CATCHES_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jpg`), Buffer.from(b64, "base64"));
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      name: `RBOLA · ${name}`,
      symbol: "RBOLA",
      description: "RBOLA catch (dev build)",
      image: `/catches/${id}.jpg`,
      attributes: [
        { trait_type: "lat", value: String(lat ?? "") },
        { trait_type: "lon", value: String(lon ?? "") },
        { trait_type: "caught_at", value: new Date().toISOString() },
        // card-frame crop (photo px) — card rendering uses this region
        { trait_type: "card_frame", value: frame ? JSON.stringify(frame) : "" },
        // AI verification verdict (gate v0)
        { trait_type: "make", value: verdict.make ?? "" },
        { trait_type: "model", value: verdict.model ?? "" },
        { trait_type: "generation", value: verdict.generation_or_trim ?? "" },
        { trait_type: "verify_confidence", value: verdict.confidence },
        // catalog provenance — provisional cards settle on founder review
        { trait_type: "spec_key", value: resolution.spec_key },
        { trait_type: "catalog", value: resolution.catalog_version },
        { trait_type: "rarity", value: resolution.rarity },
      ],
    }),
  );

  const umi = createUmi(
    `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  ).use(mplBubblegum());
  const secret = new Uint8Array(
    JSON.parse(fs.readFileSync(process.env.PAYER_KEYPAIR_PATH!, "utf8")),
  );
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

  const { signature } = await mintV2(umi, {
    leafOwner: publicKey(leafOwner),
    merkleTree: publicKey(TREE),
    metadata: {
      name: `RBOLA · ${name}`.slice(0, 32),
      // placeholder — permanent metadata hosting is a later step
      uri: `https://rbola.dev/catches/${id}.json`,
      sellerFeeBasisPoints: 500,
      collection: none(),
      creators: [],
    },
  }).sendAndConfirm(umi);

  // the node needs a moment to index the tx before it can be parsed
  let leaf;
  for (let attempt = 0; ; attempt++) {
    try {
      leaf = await parseLeafFromMintV2Transaction(umi, signature);
      break;
    } catch (e) {
      if (attempt >= 12) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // read + append with no await in between, so concurrent mints can't drop
  // each other's entries
  const index = readRegistry();
  index.push({
    assetId: leaf.id,
    photo: `/catches/${id}.jpg`,
    photoSha256: photoHash,
    name,
    lat: lat ?? null,
    lon: lon ?? null,
    frame: frame ?? null,
    time: new Date().toISOString(),
    verification: {
      generation: verdict.generation_or_trim,
      confidence: verdict.confidence,
    },
    spec_key: resolution.spec_key,
    rarity: resolution.rarity,
    provisional: resolution.provisional,
    catalog_version: resolution.catalog_version,
  });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(index, null, 1));

  return NextResponse.json({ assetId: leaf.id });
}
