# RBOLA · რბოლა

[![Live app](https://img.shields.io/badge/Live-rbola.fun-C9B37E)](https://rbola.fun)
[![X](https://img.shields.io/badge/X-%40rbola__fun-111111)](https://x.com/rbola_fun)
[![Solana Startup Village](https://img.shields.io/badge/Solana%20Startup%20Village%202026-2nd%20place-C9B37E)](https://x.com/rbola_fun)
[![Colosseum](https://img.shields.io/badge/Colosseum-Crypto%20World's%20Fair%20entrant-9945FF)](https://x.com/tatena_n/status/2095798920861331606)

**Pokémon GO for cars.** Photograph real cars in the street, own them as verified digital cards, and race them.

Spot a cool car → snap it in the app → verification (GPS + AI model recognition) → it's yours as a card with the real car's specs. Rarity comes from reality: a GR86 is everywhere, a LaFerrari catch is a monster. Your photo is the card art.

Built on Solana.

## Status

**Working today** (`web/`, landing live at [rbola.fun](https://rbola.fun)):

- The catch loop runs end to end on Solana devnet: in-browser rear camera capture (getUserMedia) with GPS tagging, photo review, then the card is minted as a real compressed NFT (Metaplex Bubblegum v2 via Helius) with your photo as the art.
- Garage reads your cards back from the chain via the Helius DAS API and shows them as a card grid.
- Installable PWA shell (no app store): mobile-first layout, bottom nav, web manifest.
- Proven spikes kept in the tree: mobile camera harness (`/spike/camera`) and Privy embedded wallet login (`/spike/wallet`).

**In progress for Colosseum's Crypto World's Fair (Sept 14 to Oct 12, 2026):**

- Anchor programs in `programs/`: race entries, prize pots, and payouts in $RBOLA.
- Verification pipeline in `server/`: AI car model recognition, GPS and timestamp checks, duplicate catch detection.
- Per-user Privy wallets wired into the catch flow, plus permanent hosting for card media and metadata.

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
- Privy embedded wallets

## Roadmap

1. `web/` (now): the catch loop. Camera to card on devnet, garage, PWA shell.
2. `server/` (next): verification. AI model recognition, GPS and timestamp checks, dedup. A catch only counts if the car is real.
3. `programs/` (Colosseum target): races. Anchor programs for $RBOLA entry races where winners split the pot.
