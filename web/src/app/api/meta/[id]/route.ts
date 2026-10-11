import fs from "node:fs";
import path from "node:path";
import { CATCHES_DIR } from "@/lib/dataDir";
import { APP_URL } from "@/lib/cluster";
import { NextResponse } from "next/server";

// Card metadata (the cNFT's on-chain uri points here). Written once at mint
// in api/catch; early devnet cards stored a relative image path, made
// absolute on the way out so wallets and explorers can load it.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-z0-9]+$/.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const p = path.join(CATCHES_DIR, `${id}.json`);
  if (!fs.existsSync(p)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const meta = JSON.parse(fs.readFileSync(p, "utf8"));
  if (typeof meta.image === "string" && meta.image.startsWith("/catches/")) {
    meta.image = `${APP_URL}/api/photo/${meta.image.slice("/catches/".length)}`;
  }
  return NextResponse.json(meta, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
