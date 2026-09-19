import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplBubblegum,
  mintV2,
  parseLeafFromMintV2Transaction,
} from "@metaplex-foundation/mpl-bubblegum";
import { keypairIdentity, none, publicKey } from "@metaplex-foundation/umi";

// the spike tree from step 5 — 16k card slots
const TREE = "7hZ1FXsYbFWon6rxrJydouX5dcsATMSFejsnNR4My41u";

export async function POST(req: NextRequest) {
  const { photo, name, lat, lon, frame, owner } = await req.json();
  if (!photo || !name) {
    return NextResponse.json(
      { error: "photo and name are required" },
      { status: 400 },
    );
  }
  // mint to the logged-in user's wallet when provided; founder wallet fallback
  const leafOwner =
    typeof owner === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)
      ? owner
      : process.env.CATCH_OWNER!;

  // v0: photos live on the dev server's disk; real hosting (Irys) comes later
  const id = Date.now().toString(36);
  const dir = path.join(process.cwd(), "public", "catches");
  fs.mkdirSync(dir, { recursive: true });
  const b64 = String(photo).replace(/^data:image\/\w+;base64,/, "");
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

  const indexPath = path.join(dir, "index.json");
  const index = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : [];
  index.push({
    assetId: leaf.id,
    photo: `/catches/${id}.jpg`,
    name,
    lat: lat ?? null,
    lon: lon ?? null,
    frame: frame ?? null,
    time: new Date().toISOString(),
  });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));

  return NextResponse.json({ assetId: leaf.id });
}
