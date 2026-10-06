// Server-side catch verification (gate v0): Claude vision identifies the car
// and judges authenticity; the verdict is returned to the client as an
// HMAC-signed token that /api/catch requires before minting, so the sheet's
// verify step can't be skipped and recognition isn't paid for twice.

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.VERIFY_MODEL ?? "claude-opus-4-8";
const TOKEN_TTL_MS = 10 * 60 * 1000;

export type Verdict = {
  is_car: boolean;
  make: string | null;
  model: string | null;
  generation_or_trim: string | null;
  confidence: "high" | "medium" | "low";
  authenticity_suspicion: string | null;
  visible_evidence: string;
};

export type GateResult =
  | { passed: true; name: string }
  | { passed: false; reason: "not_a_car" | "authenticity" | "low_confidence"; message: string };

const SCHEMA = {
  type: "object",
  properties: {
    is_car: { type: "boolean" },
    make: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    generation_or_trim: {
      type: ["string", "null"],
      description: "generation/trim only if visually determinable",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    authenticity_suspicion: {
      type: ["string", "null"],
      description:
        "null if the photo looks like a genuine street photo; otherwise name the suspicion: screen/monitor re-photograph, AI-generated image, print/poster, toy/model car, heavy editing",
    },
    visible_evidence: {
      type: "string",
      description: "the concrete visual details the identification is based on",
    },
  },
  required: [
    "is_car",
    "make",
    "model",
    "generation_or_trim",
    "confidence",
    "authenticity_suspicion",
    "visible_evidence",
  ],
  additionalProperties: false,
} as const;

const PROMPT = `You are the verification engine of a car-spotting game. Identify the car in the photo.
Rules:
- Identify make and model only from what is actually visible; name the specific visual evidence.
- generation_or_trim: fill only if the visible details truly distinguish it (e.g. a 911 GT3's fixed rear wing); otherwise null.
- confidence "high" only when the evidence is unambiguous.
- If there is no real car in the photo (or it's a toy, a screen, a drawing), set is_car=false.
- Independently judge authenticity: does this look like a genuine photo of a physical scene, or a re-photographed screen/print, an AI-generated image, or a toy? Report suspicion even when unsure.`;

// lazy — a missing ANTHROPIC_API_KEY must not break /api/catch, which
// imports this module only for token verification
let client: Anthropic | null = null;

export async function recognizePhoto(base64Jpeg: string): Promise<Verdict> {
  client ??= new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: base64Jpeg },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text) throw new Error("recognition returned no result");
  return JSON.parse(text.text) as Verdict;
}

// Gate rule v0: real car, no authenticity suspicion, medium+ confidence.
// "medium" passes but stays visible in the stored verdict for a future
// review queue; rarity and venue policy (showroom catches) are later rules.
export function evaluateVerdict(verdict: Verdict): GateResult {
  if (!verdict.is_car) {
    return {
      passed: false,
      reason: "not_a_car",
      message: "No car found in this photo",
    };
  }
  if (verdict.authenticity_suspicion) {
    return {
      passed: false,
      reason: "authenticity",
      message: "This doesn't look like a live street photo",
    };
  }
  if (verdict.confidence === "low") {
    return {
      passed: false,
      reason: "low_confidence",
      message: "Can't identify the car — get closer or retake",
    };
  }
  return { passed: true, name: verdictName(verdict) };
}

export function verdictName(verdict: Verdict): string {
  return (
    [verdict.make, verdict.model].filter(Boolean).join(" ") ||
    "Unidentified car"
  );
}

// --- signed verdict token: base64url(payload).base64url(hmac) ---

type TokenPayload = { photoSha256: string; verdict: Verdict; exp: number };

function signingSecret(): Buffer {
  const secret = process.env.VERIFY_SIGNING_SECRET;
  if (!secret) throw new Error("VERIFY_SIGNING_SECRET is not set");
  return Buffer.from(secret, "utf8");
}

function hmac(payload: string): Buffer {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest();
}

export function photoSha256(base64Jpeg: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(base64Jpeg, "base64"))
    .digest("hex");
}

export function createVerificationToken(
  photoHash: string,
  verdict: Verdict,
): string {
  const payload: TokenPayload = {
    photoSha256: photoHash,
    verdict,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body).toString("base64url")}`;
}

// Returns the embedded verdict only for a valid, unexpired token whose
// photo hash matches the submitted photo; null otherwise.
export function readVerificationToken(
  token: string,
  expectedPhotoHash: string,
): Verdict | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = hmac(body);
    const given = Buffer.from(sig, "base64url");
    if (expected.length !== given.length) return null;
    if (!crypto.timingSafeEqual(expected, given)) return null;
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as TokenPayload;
    if (payload.exp < Date.now()) return null;
    if (payload.photoSha256 !== expectedPhotoHash) return null;
    return payload.verdict;
  } catch {
    return null;
  }
}
