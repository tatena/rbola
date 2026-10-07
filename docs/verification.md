# Catch Verification (gate v0)

Every RBOLA card is supposed to be proof of a real, live car sighting. This
document describes the verification gate that enforces that promise: how a
photo is recognized, how the accept/reject decision is made, and how the
verdict is carried to the mint endpoint so the check cannot be skipped.

## The problem

Minting happens in two steps initiated by an untrusted client: the capture
sheet asks "what did I catch?" and then, on user confirmation, the mint
endpoint creates the cNFT. Before any mint the server must know:

1. **What car is this?** — make, model, and when visually determinable, the
   generation/trim (card identity comes from this, not from user input).
2. **Is the photo authentic?** — a live photo of a physical scene, not a
   re-photographed screen, a print, an AI-generated image, or a toy.

And the answer must be unforgeable across the two requests.

## Architecture

```
phone camera ──photo──▶ POST /api/verify ──▶ vision LLM (Claude API)
                              │                 structured output
                              ▼
                   gate passed? ──▶ catalog resolver (spec + rarity)
                              │       main → pending → fresh AI draft
                              ▼
            verdict + resolution + signed token
                              │
phone ──photo + token──▶ POST /api/catch ──▶ token valid? gate passed?
                                                   │
                                                   ▼
                                             mint cNFT (Bubblegum v2)
```

| Piece | Location | Role |
|---|---|---|
| `verifyCatch.ts` | `web/src/lib/` | recognition call, gate rule, token sign/verify |
| `catalog.ts` | `web/src/lib/` | spec resolution, AI spec drafts, derived stats |
| `POST /api/verify` | `web/src/app/api/verify/` | photo → verdict + spec resolution + token |
| `POST /api/catch` | `web/src/app/api/catch/` | refuses to mint without a valid token |
| `GET /api/garage` | `web/src/app/api/garage/` | cards read live catalog entries (settlement) |
| capture sheet | `web/src/app/(app)/catch/` | ASSESSING beat = the live verify call |

## Recognition: an LLM as a structured classifier

Recognition is one call per photo to a vision LLM (Claude, model configurable
via `VERIFY_MODEL`). Two engineering decisions matter:

**The response is schema-enforced, not parsed.** The request uses the API's
structured-output mode with a JSON Schema, so the reply is guaranteed to be:

```json
{
  "is_car": true,
  "make": "Audi",
  "model": "R8",
  "generation_or_trim": "Type 4S (second generation)",
  "confidence": "high",
  "authenticity_suspicion": null,
  "visible_evidence": "four-ring logo on nose, hexagonal grille, ..."
}
```

`authenticity_suspicion` is the anti-cheat field: the prompt instructs the
model to independently judge whether the image is a genuine photo of a
physical scene and to name the suspicion otherwise (screen re-photograph,
print, AI image, toy, heavy editing).

**The decision is deterministic code, not AI.** The gate rule is three
predicates over that JSON (`evaluateVerdict`):

| Check | Fails when | Client sees |
|---|---|---|
| real car | `is_car == false` | "No car found in this photo" |
| authentic | `authenticity_suspicion != null` | "This doesn't look like a live street photo" |
| identifiable | `confidence == "low"` | "Can't identify the car — get closer or retake" |

`medium` confidence passes but is persisted in the card metadata for a future
review queue. On pass, `make + model` becomes the card name — the previous
hardcoded placeholder autofill is gone.

**Why a generalist LLM instead of a car-recognition vendor API:** long-tail
coverage (the model knows a Lada 2107 and a Huracán Tecnica equally well,
where fixed commercial catalogs are explicitly post-1995), no procurement
cycle, and the same single call doubles as fraud detection — "is this a photo
of a screen?" is not a question a closed classifier can answer. Measured on a
63-photo benchmark of real phone captures before this was built: 20/20 cars
identified (generation-level), 43/43 non-cars rejected, zero false positives,
all 9 planted fakes (screen re-photographs, AI images) flagged. ~5s latency,
roughly $0.03/photo at current Opus pricing; the engine is a single function
behind an env-var model id, so swapping to a cheaper tier is a config change.

## From verdict to card: the two-layer catalog

A passed verdict names the car; the catalog turns it into a card with real
factory specs (hp, 0–100, top speed, curb weight), a street-rarity tier, and
derived race stats. Resolution order in `catalog.ts`:

1. **Main catalog** (`src/data/catalog/main.json`) — curated, versioned,
   bundled at build time. Entries are frozen once published: this is the
   never-buff/nerf promise enforced by architecture. Generation ambiguity is
   resolved cheaply from the recognizer's generation string, or by letting
   the spec-draft call confirm the generation from the photo.
2. **Pending catalog** (`data/catalog-pending.json`) — when a verified car
   isn't listed, one extra AI call drafts its spec (photo confirms the
   generation; most common production trim; sanity bounds force
   `spec_confidence: low` on outliers) and the entry is quarantined here.
   Deduped by make+model so generation wording wobble can't fork entries.
3. The player never hits a dead end and never learns the car "wasn't in our
   list" — the card mints either way.

Cards minted from pending entries are **provisional**: the garage reads the
live entry on every load, so when the entry is reviewed and promoted to main
(specs corrected if needed), the card settles once and is frozen from then on.
Until settled, provisional cards are excluded from paid races (the race gate).

Race stats (`SPEED`/`ACCEL`/`HANDLING`, 1–100) are a pure function of the
spec (`deriveStats`) — one tunable place, deterministic by design.

## The trust boundary: signed verdict tokens

The verdict must travel through the untrusted client between `/api/verify`
and `/api/catch`. It travels signed:

```
token = base64url(payload) + "." + base64url(HMAC-SHA256(payload, secret))
payload = { photoSha256, verdict, resolution, exp }   // exp = issue time + 10 min
```

`/api/catch` recomputes SHA-256 over the submitted photo bytes, verifies the
signature (constant-time compare), checks expiry, and — defense in depth —
re-runs `evaluateVerdict` on the embedded verdict. Consequences:

- no token → no mint (403)
- a token cannot be replayed onto a different photo (hash binding is over
  decoded bytes, so base64 re-encoding tricks don't bypass it)
- a token cannot be forged or modified without `VERIFY_SIGNING_SECRET`,
  which never leaves the server
- an expired token is recoverable: the mint store re-verifies the same photo
  for a fresh token and retries once (the photo must pass the gate again)

This is the signed-JWT pattern without the library — one secret, one
algorithm, no header to confuse.

## Client flow

Verification starts the moment the shutter fires (during the capture
transition), so the mint sheet's ASSESSING shimmer usually resolves in a few
seconds: verified → the recognized name fills the sheet and MINT enables;
rejected → the reason replaces the name, the chip reads REJECTED, and Retake
is the only path forward. In-flight results are dropped on retake via a
request-id guard. The dev bulk-upload tool goes through the same gate — there
is no unverified path to `/api/catch`.

## Configuration

| Env var (`web/.env.local`) | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | vision API access (server-side only) |
| `VERIFY_SIGNING_SECRET` | HMAC key for verdict tokens (e.g. `openssl rand -hex 32`) |
| `VERIFY_MODEL` | optional model override (default `claude-opus-4-8`) |

## Known gaps (v0, deliberately sequenced)

- **No owner binding** — the token is bound to the photo, not the minting
  wallet; lands with the auth wiring.
- **No dedup yet** — the same physical car can be caught repeatedly. Planned:
  perceptual hash + plate hash (the model already reads visible plates) +
  GPS/time clustering.
- **No GPS/timestamp plausibility checks yet** — separate layer.
- **Main catalog is empty (v0)** — until the curated seed list is reviewed
  and frozen as catalog v1, every first catch of a model takes the pending
  path (one extra AI call, ~3s, ~$0.03) and mints provisional. Shrinks as
  the main catalog grows.
- **Stat normalization is a first guess** — `deriveStats` ranges spread the
  real fleet across 1–100 but haven't been tuned against the race engine
  (which doesn't exist yet).
- **No rate limiting** on `/api/verify` — each call costs real money; needed
  before public exposure.
