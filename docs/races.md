# Races (backend v0)

Cards race for SOL. Two players who chose the same track and the same rarity
room each pay the room's entry fee; the car whose real specs suit that ground
better takes the pot, minus a 15% rake. This document describes how the race
backend works on devnet today.

## The game in one paragraph

Entry order is **track → tier → car**. The track (MOUNTAIN PASS, HIGHWAY RUN,
DRAG STRIP) weights three stats — speed, acceleration, handling — that are
derived from the car's factory specs in the catalog. The tier is a **rarity
room** (COMMON → LEGENDARY): only a card of that rarity can enter, and the fee
rises with rarity. The opponent's car stays hidden until the match. Resolution
is a pure function: no luck, no wear, no upgrades — the same two cards on the
same track always produce the same result.

| Track | Speed | Accel | Handling |
|---|---|---|---|
| MOUNTAIN PASS | 0.2 | 0.3 | 0.5 |
| HIGHWAY RUN | 0.5 | 0.3 | 0.2 |
| DRAG STRIP | 0.3 | 0.6 | 0.1 |

Fee ladder (devnet demo values): 0.01 / 0.02 / 0.05 / 0.10 / 0.25 SOL.

## Architecture

No smart contract. A server-side ledger tracks entries and races; every SOL
movement is a real on-chain transfer to or from a dedicated **race wallet**
(a server keypair, separate from the mint payer so pots never mix with gas).

```
car select ──ENTER──▶ POST /api/race/entry
                        checks: card owned (Helius DAS), rarity = room,
                        specs settled, card not already entered
                        ◀── unsigned transfer: player → race wallet,
                            fee + memo "rbola race entry <id>"
player wallet (Privy) signs
          ──signed tx──▶ POST /api/race/entry/:id/confirm
                        signed message must equal the issued one byte-for-byte
                        → broadcast → confirmed → queue (track, room)
                        → FIFO match with another wallet, or wait
client polls ───────▶ GET /api/race/entry/:id
                        no rival after ~20s → a house car takes the seat
                        match → resolve → payout from the race wallet
```

The profile reads a player's record from `GET /api/race/stats?owner=<wallet>`
(read-only): paid races, wins / losses / ties, win rate, current streak, SOL
won and net, practice counted apart, and recent races for the activity list.

- **Unforgeable entries.** The server builds the entry transfer and keeps its
  message. The wallet only signs. On confirm, the server rejects any
  transaction whose message differs from the issued one, so the amount,
  recipient and memo can't be altered, and a signed entry can't be replayed
  onto another entry.
- **Payouts can't double-send.** Each payout is signed first and its signature
  is written to the ledger before broadcast. A retry checks that signature
  on-chain and only re-signs if it provably never landed.
- **One lock.** Every ledger change runs through a single in-process queue, so
  matching, cancelling and paying out can't interleave.

## Money rules

- Win: the winner receives `2 × fee × 85%` (the remaining 15% is the rake).
- Exact tie: both entries are refunded in full, with no rake taken.
- Cancel while searching: full refund.
- House opponent (devnet only): seats after ~20s with no rival and stakes a
  ledger-only entry. If the player wins they're paid the normal winner's take.
  If the house wins, the player's entry stays in the race wallet.
- Practice: free, instant, against a house car, any card. No SOL moves.

## Verified on devnet (2026-10-10)

Scripted end-to-end with two test wallets against the running app:

- Player vs player: both entries confirmed on-chain, matched FIFO. Same car
  on both sides gave an exact tie, so both were refunded in full.
- House win: player paid 0.17 SOL (0.2 pot − 15%).
- House loss: no payout, and the entry stayed in the race wallet.
- Cancel while searching: full refund.
- Rejected: wrong rarity room, someone else's card, a tampered amount, and a
  replayed confirm.
- Race wallet balance reconciles with the ledger.

## Code

- `web/src/lib/race.ts` — pure core: weights, fee ladder, rake, `score`, `resolve`.
- `web/src/lib/raceLedger.ts` — ledger (`web/data/races.json`), lock, flows, payouts.
- `web/src/lib/raceWallet.ts` — race wallet, entry-tx build/verify, payout send.
- `web/src/lib/useRaceEntry.ts` — client: `enter()` creates → signs → confirms and resolves with the entry id; `useRaceWatch(id)` polls it and exposes cancel.
- `web/src/app/(app)/race/live/[id]/` — post-commit screens keyed by entry id (survive reload): SEARCHING (cancel = full refund) → VS reveal → race beat → RESULT (SOL line + payout tx on Explorer).
- `web/data/house-cars.json` — house roster, rotated deterministically per room.

## Known limits (v0)

- The API trusts the posted wallet address (no server-side Privy session check
  yet). Funds stay safe: an entry is only paid by a transfer that wallet
  signed, and payouts or refunds only go back to the paying wallet.
- The ledger is a JSON file on one server process, which is fine for a demo.
  A database is needed before multiple instances run.
- The house as counterparty is devnet-only. Paid races on mainnet wait for a
  legal review.
