# RBOLA web app

The Next.js PWA behind [rbola.fun](https://rbola.fun): camera capture, card minting, garage, and races. See the [repo README](../README.md) for what RBOLA is and the current status.

## Develop

```bash
npm install
npm run dev     # dev server on http://localhost:3000
npm run build   # production build
npm run lint
```

Camera and GPS need a real phone for honest testing. `npm run dev` works on desktop with a webcam; for wallet flows (Privy) serve over HTTPS, for example through a tunnel.

## Environment

Create `web/.env.local` (gitignored):

```
NEXT_PUBLIC_PRIVY_APP_ID=   # Privy app id (client-side, enables login)
PRIVY_VERIFICATION_KEY=     # Privy ES256 public key, base64 body only (server checks sessions)
PRIVY_APP_SECRET=           # Privy app secret (server looks up a user's wallets)
HELIUS_API_KEY=             # Helius devnet RPC + DAS
PAYER_KEYPAIR_PATH=         # local path to the devnet mint payer keypair
CATCH_OWNER=                # fallback wallet for dev builds without Privy
ANTHROPIC_API_KEY=          # catch verification (vision)
VERIFY_SIGNING_SECRET=      # HMAC key for verdict tokens
RACE_KEYPAIR_PATH=          # race wallet (pots), separate from the payer
RACE_ALLOW_PROVISIONAL=     # devnet only: 1 lets provisional cards into paid races
FAUCET_KEYPAIR_PATH=        # devnet starter-SOL faucet (refuses on any other cluster)
DATA_DIR=                   # prod: catches + state outside the app folder
```

With Privy configured, routes that mint, drip SOL or touch a race entry require the player's session (`src/lib/auth.ts`) and fail closed if either Privy server secret is missing. Never put server vars in Vercel env: the app runs on its own server (`../deploy/`).

## Layout

```
src/app/
├── page.tsx        public landing (rbola.fun)
├── (app)/          the mobile app: catch, upload, garage, race, me
├── api/            server routes: catch (mint), garage (DAS read), photo
└── spike/          proven spikes kept for reference: camera, wallet
src/lib/            mint handoff store, wallet owner hook
```

Minting is server-side (Bubblegum v2 compressed NFTs on Solana devnet via Helius); the payer keypair never reaches the browser. Photos are stored on the dev server disk for now (`public/catches/`, gitignored); permanent hosting comes with the verification pipeline.
