import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { resolveSpec } from "@/lib/catalog";
import { allow, clientIp } from "@/lib/rateLimit";
import {
  createVerificationToken,
  evaluateVerdict,
  photoSha256,
  recognizePhoto,
} from "@/lib/verifyCatch";

// ≈5MB decoded — the vision API's own per-image cap; camera captures are
// well under this (the 63-photo spike set all passed)
const MAX_PHOTO_B64_CHARS = 6.7 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // fail fast before the paid recognition call
  if (!process.env.VERIFY_SIGNING_SECRET) {
    console.error("VERIFY_SIGNING_SECRET is not set");
    return NextResponse.json(
      { error: "verification is not configured" },
      { status: 500 },
    );
  }

  let photo: unknown;
  try {
    ({ photo } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (typeof photo !== "string" || !photo.startsWith("data:image/")) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
  }
  const b64 = photo.replace(/^data:image\/\w+;base64,/, "");
  if (b64.length > MAX_PHOTO_B64_CHARS) {
    return NextResponse.json({ error: "photo too large" }, { status: 413 });
  }

  // every check is a paid vision call — cap it per network and globally
  if (
    !allow(`verify:${clientIp(req)}`, 30, 3600_000) ||
    !allow("verify:all", 600, 24 * 3600_000)
  ) {
    return NextResponse.json(
      { error: "too many checks — try again later" },
      { status: 429 },
    );
  }

  let verdict;
  try {
    verdict = await recognizePhoto(b64);
  } catch (e) {
    // the model couldn't take this image (too large/corrupt) — retrying the
    // same photo can't help, so tell the client to retake instead
    if (e instanceof Anthropic.BadRequestError) {
      return NextResponse.json(
        { error: "photo unreadable — retake" },
        { status: 422 },
      );
    }
    console.error("verification failed:", e);
    return NextResponse.json(
      { error: "verification unavailable — try again" },
      { status: 502 },
    );
  }

  const gate = evaluateVerdict(verdict);
  if (!gate.passed) {
    // a confident negative is a successful verification, not a server error
    return NextResponse.json({
      verified: false,
      reason: gate.reason,
      message: gate.message,
    });
  }

  // catalog resolution: main → pending → fresh AI spec draft. The player
  // never sees which path ran — an unlisted car gets a provisional entry
  // drafted on the spot and mints like any other catch.
  let resolution;
  try {
    resolution = await resolveSpec({
      make: verdict.make ?? "",
      model: verdict.model ?? "",
      generation: verdict.generation_or_trim,
      photoB64: b64,
    });
  } catch (e) {
    console.error("spec resolution failed:", e);
    return NextResponse.json(
      { error: "verification unavailable — try again" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    verified: true,
    name: gate.name,
    generation: verdict.generation_or_trim,
    confidence: verdict.confidence,
    rarity: resolution.rarity,
    token: createVerificationToken(photoSha256(b64), verdict, resolution),
  });
}
