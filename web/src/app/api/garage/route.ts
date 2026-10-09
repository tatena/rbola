import fs from "node:fs";
import { REGISTRY_PATH } from "@/lib/dataDir";
import { NextResponse } from "next/server";
import { deriveStats, getEntry } from "@/lib/catalog";

type CatchRecord = {
  assetId: string;
  photo: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
  frame?: { x: number; y: number; width: number; height: number } | null;
  time: string;
  hidden?: boolean;
  rarity?: string;
  spec_key?: string;
  provisional?: boolean;
};

export async function GET(req: Request) {
  // garage of the logged-in user's wallet; the founder-wallet fallback exists
  // only for dev builds without auth — signed out with auth = empty garage
  const qOwner = new URL(req.url).searchParams.get("owner");
  const valid = !!qOwner && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(qOwner);
  if (!valid && process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return NextResponse.json({ total: 0, cards: [], sol: null });
  }
  const owner = valid ? qOwner : process.env.CATCH_OWNER;
  const rpc = `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  const call = (body: object) =>
    fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }).then((r) => r.json());

  const [assets, balance] = await Promise.all([
    call({
      jsonrpc: "2.0",
      id: "garage",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: owner,
        page: 1,
        limit: 100,
      },
    }),
    call({
      jsonrpc: "2.0",
      id: "balance",
      method: "getBalance",
      params: [owner],
    }).catch(() => null),
  ]);

  if (assets.error) {
    return NextResponse.json(
      { error: JSON.stringify(assets.error) },
      { status: 502 },
    );
  }

  const indexPath = REGISTRY_PATH;
  const local: CatchRecord[] = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : [];
  const byAsset = new Map(local.map((c) => [c.assetId, c]));

  // registry entries flagged hidden are dropped from the app (burning a cNFT
  // needs the owner wallet's signature, which the server doesn't hold)
  const items = assets.result.items.filter(
    (a: { id: string }) => !byAsset.get(a.id)?.hidden,
  );
  const cards = items.map(
    (a: { id: string; content?: { metadata?: { name?: string } } }) => {
      const rec = byAsset.get(a.id);
      // cards read the LIVE catalog entry: provisional cards settle to the
      // founder-reviewed spec automatically on promotion (Option B)
      const entry = rec?.spec_key ? getEntry(rec.spec_key) : null;
      return {
        assetId: a.id,
        // registry name wins — on-chain names are frozen at mint, the
        // registry can be corrected (e.g. AI/manual car identification)
        name: rec?.name
          ? `RBOLA · ${rec.name}`
          : (a.content?.metadata?.name ?? "(unnamed)"),
        // photos are served via the live-disk route — see api/photo/[file]
        photo: rec?.photo
          ? rec.photo.replace(/^\/catches\//, "/api/photo/")
          : null,
        rarity: entry?.rarity ?? rec?.rarity ?? null,
        spec: entry?.spec ?? null,
        stats: entry ? deriveStats(entry.spec) : null,
        // race gate: provisional (pending-catalog) cards can't enter paid
        // races until their spec settles — entry.status is the live truth
        provisional: entry ? entry.status !== "verified" : (rec?.provisional ?? false),
        lat: rec?.lat ?? null,
        lon: rec?.lon ?? null,
        frame: rec?.frame ?? null,
        time: rec?.time ?? null,
      };
    },
  );

  const lamports = balance?.result?.value;
  return NextResponse.json({
    total: assets.result.total - (assets.result.items.length - items.length),
    cards,
    sol: typeof lamports === "number" ? lamports / 1e9 : null,
    // devnet flag (founder call 10-08): provisional cards may enter paid races
    raceProvisional: process.env.RACE_ALLOW_PROVISIONAL === "1",
  });
}
