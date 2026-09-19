import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

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
};

export async function GET(req: Request) {
  // garage of the logged-in user's wallet; fallback = founder catch wallet
  // (logged-out dev/review keeps working)
  const qOwner = new URL(req.url).searchParams.get("owner");
  const owner =
    qOwner && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(qOwner)
      ? qOwner
      : process.env.CATCH_OWNER;
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

  const indexPath = path.join(process.cwd(), "public", "catches", "index.json");
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
        rarity: rec?.rarity ?? null,
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
  });
}
