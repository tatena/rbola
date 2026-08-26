// AI car-recognition spike: Claude vision vs known test photos.
// Usage: npm run recognize  (needs ANTHROPIC_API_KEY in scripts/.env)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const MODEL = "claude-opus-4-8";
const PRICE_IN = 5 / 1e6; // $/token
const PRICE_OUT = 25 / 1e6;

// ground truth: the three curated test shots + her real phone catches
const CARD_ASSETS = "/Users/tatena/Desktop/nino/carspotting/card-assets";
const CATCHES = "/Users/tatena/Desktop/nino/carspotting/rbola/web/public/catches";

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

const client = new Anthropic();

async function recognize(file: string) {
  const data = fs.readFileSync(file).toString("base64");
  const started = Date.now();
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
            source: { type: "base64", media_type: "image/jpeg", data },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const seconds = (Date.now() - started) / 1000;
  const usd =
    response.usage.input_tokens * PRICE_IN +
    response.usage.output_tokens * PRICE_OUT;

  const text = response.content.find((b) => b.type === "text");
  const result = JSON.parse(text!.text);
  console.log(`\n=== ${path.basename(file)} (${seconds.toFixed(1)}s, $${usd.toFixed(4)})`);
  console.log(
    `    is_car=${result.is_car} | ${result.make ?? "-"} ${result.model ?? "-"} | trim: ${result.generation_or_trim ?? "-"} | confidence: ${result.confidence}`,
  );
  if (result.authenticity_suspicion) {
    console.log(`    ⚠ authenticity: ${result.authenticity_suspicion}`);
  }
  console.log(`    evidence: ${result.visible_evidence}`);
}

const files = [
  ...["zonda.jpg", "gt3.jpg", "gr86.jpg"].map((f) => path.join(CARD_ASSETS, f)),
  ...fs
    .readdirSync(CATCHES)
    .filter((f) => f.endsWith(".jpg"))
    .map((f) => path.join(CATCHES, f)),
];

for (const file of files) {
  try {
    await recognize(file);
  } catch (e) {
    console.log(`\n=== ${path.basename(file)} FAILED: ${e instanceof Error ? e.message : e}`);
  }
}
