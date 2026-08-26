import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

type CatchRecord = {
  assetId: string;
  photo: string;
  name: string;
  time: string;
};

export async function GET() {
  const res = await fetch(
    `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "garage",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: process.env.CATCH_OWNER,
          page: 1,
          limit: 100,
        },
      }),
      cache: "no-store",
    },
  );
  const { result, error } = await res.json();
  if (error) {
    return NextResponse.json({ error: JSON.stringify(error) }, { status: 502 });
  }

  const indexPath = path.join(process.cwd(), "public", "catches", "index.json");
  const local: CatchRecord[] = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : [];
  const byAsset = new Map(local.map((c) => [c.assetId, c]));

  const cards = result.items.map(
    (a: {
      id: string;
      content?: { metadata?: { name?: string } };
    }) => ({
      assetId: a.id,
      name: a.content?.metadata?.name ?? "(unnamed)",
      photo: byAsset.get(a.id)?.photo ?? null,
      time: byAsset.get(a.id)?.time ?? null,
    }),
  );

  return NextResponse.json({ total: result.total, cards });
}
