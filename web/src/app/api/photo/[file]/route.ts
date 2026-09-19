import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

// Catch photos are written to public/catches at runtime; the production
// server only serves public/ from the build snapshot, so later files 404.
// This route reads them from disk live.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!/^[a-z0-9]+\.jpg$/.test(file)) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }
  const p = path.join(process.cwd(), "public", "catches", file);
  if (!fs.existsSync(p)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(fs.readFileSync(p)), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
