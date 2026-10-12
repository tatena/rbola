import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { resolveSpec } from "@/lib/catalog";
import { allow, clientIp } from "@/lib/rateLimit";
import { authEnabled, callerId, hasBearer } from "@/lib/auth";
import {
  MAX_PHOTO_B64_CHARS,
  createVerificationToken,
  evaluateVerdict,
  photoSha256,
  recognizePhoto,
  type Verdict,
} from "@/lib/verifyCatch";
import type { Resolution } from "@/lib/catalog";

// One answer per photo: re-sending the same bytes returns the first verdict
// (and resolution) instead of a fresh model call, so a rejection can't be
// re-rolled until it passes and a rarity can't be shopped for. In memory,
// 24h, bounded — the photo-hash dedup at mint covers the rest.
type Outcome = { at: number; body: Record<string, unknown>; verdict?: Verdict; resolution?: Resolution };
const seen = ((globalThis as unknown as { __verdicts?: Map<string, Outcome> }).__verdicts ??= new Map());
const SEEN_MS = 24 * 3600_000;
function remember(hash: string, o: Omit<Outcome, "at">) {
  if (seen.size > 5000) for (const k of [...seen.keys()].slice(0, 1000)) seen.delete(k);
  seen.set(hash, { at: Date.now(), ...o });
}

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

  const hash = photoSha256(b64);
  const hit = seen.get(hash);
  if (hit && Date.now() - hit.at < SEEN_MS) {
    return NextResponse.json(
      hit.verdict && hit.resolution
        ? { ...hit.body, token: createVerificationToken(hash, hit.verdict, hit.resolution) }
        : hit.body,
    );
  }

  // every check is a paid vision call. Logged-in players get their own
  // budget plus a shared one that anonymous traffic can't touch, so nobody
  // can lock real players out by burning a single global cap.
  let who: string | null = null;
  if (authEnabled && hasBearer(req)) who = await callerId(req).catch(() => null);
  const ok = who
    ? allow(`verify:u:${who}`, 20, 3600_000) &&
      allow(`verify:ud:${who}`, 60, 24 * 3600_000) &&
      allow("verify:users", 1500, 24 * 3600_000)
    : allow(`verify:${clientIp(req)}`, 10, 3600_000) && allow("verify:anon", 150, 24 * 3600_000);
  if (!ok) {
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
    const body = { verified: false, reason: gate.reason, message: gate.message };
    remember(hash, { body });
    return NextResponse.json(body);
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

  const body = {
    verified: true,
    name: gate.name,
    generation: verdict.generation_or_trim,
    confidence: verdict.confidence,
    rarity: resolution.rarity,
  };
  remember(hash, { body, verdict, resolution });
  return NextResponse.json({ ...body, token: createVerificationToken(hash, verdict, resolution) });
}
