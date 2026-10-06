# RBOLA · რბოლა

[![Live app](https://img.shields.io/badge/Live-rbola.fun-C9B37E)](https://rbola.fun)
[![X](https://img.shields.io/badge/X-%40rbola__fun-111111)](https://x.com/rbola_fun)
[![Solana Startup Village](https://img.shields.io/badge/Solana%20Startup%20Village%202026-2nd%20place-C9B37E)](https://x.com/rbola_fun)
[![Colosseum](https://img.shields.io/badge/Colosseum-Crypto%20World's%20Fair%20entrant-9945FF)](https://x.com/tatena_n/status/2095798920861331606)

**Pokémon GO for cars.** Photograph real cars in the street, own them as verified digital cards, and race them.

Spot a cool car → snap it in the app → verification (GPS + AI model recognition) → it's yours as a card with the real car's specs. Rarity comes from reality: a GR86 is everywhere, a LaFerrari catch is a monster. Your photo is the card art.

Built on Solana.

## Status

**Working today** (`web/`, on Solana devnet, not yet live for users; the public page at [rbola.fun](https://rbola.fun) is the landing only):

- **AI verification gate (new):** every catch is verified before it can mint. A vision model identifies the real make/model — that names the card, no user input — and judges authenticity: non-cars, re-photographed screens, prints, and AI images are rejected on the capture sheet with the reason. The verdict travels to the mint endpoint as an HMAC-signed token bound to the photo's hash, so the check can't be skipped. Proven on-phone: street cars verified and named, a car photographed off a laptop screen rejected. Design and benchmark results in [`docs/verification.md`](docs/verification.md).
- The catch loop runs end to end on Solana devnet: in-browser rear camera capture (getUserMedia) with GPS tagging, card-frame crop, verification, then the card is minted as a real compressed NFT (Metaplex Bubblegum v2 via Helius) with your photo as the art and the verified identity in its metadata.
- Garage reads your cards back from the chain via the Helius DAS API and renders them as a 3D card carousel — tap to flip to the spec side.
- Designed screens built: scanner, capture-to-mint sheet, garage, profile, race car-select.
- Installable PWA shell (no app store): mobile-first layout, bottom nav, web manifest.
- Proven spikes kept in the tree: mobile camera harness (`/spike/camera`) and Privy embedded wallet login (`/spike/wallet`).

**In progress for Colosseum's Crypto World's Fair (Sept 14 to Oct 12, 2026):**

- Races: SOL-entry races where winners split the pot — race screens, server-side resolution, and escrow/payouts.
- Verification hardening: duplicate-catch detection (the model already reads plates), GPS and timestamp plausibility checks, and a versioned car catalog to pin exact generations and drive rarity.
- Per-user Privy wallets wired through the whole flow, plus permanent hosting for card media and metadata.

## Monorepo layout

```
rbola/
├── web/        Next.js PWA: camera capture, garage, races
├── server/     (planned) verification pipeline
└── programs/   (planned) on-chain programs (Anchor)
```

## Tech stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4
- PWA: getUserMedia camera, Geolocation API, web manifest
- Solana: Metaplex Bubblegum v2 compressed NFTs (Umi), Helius RPC + DAS
- AI verification: Claude vision API with schema-enforced structured output, HMAC-signed verdict tokens
- Privy embedded wallets

## Roadmap

1. `web/` (done): the catch loop. Camera to card on devnet, garage, PWA shell.
2. Verification (v0 shipped, in `web/`): AI model recognition names the card and rejects fakes — a catch only counts if the car is real. Next: dedup, GPS/timestamp checks, and the car catalog; graduates into `server/` as the pipeline grows.
3. Races (Colosseum target): SOL-entry races where winners split the pot — screens, resolution engine, and on-chain escrow in `programs/`.
