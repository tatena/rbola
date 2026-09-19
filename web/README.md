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
HELIUS_API_KEY=             # Helius devnet RPC + DAS
PAYER_KEYPAIR_PATH=         # local path to the devnet payer keypair
CATCH_OWNER=                # fallback wallet for mints when logged out
```

Without the server vars the app still runs; minting and garage reads are disabled. Never deploy the server vars to public hosting: the mint endpoint must stay dead in production until verification exists.

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
