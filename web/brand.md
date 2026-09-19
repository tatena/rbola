# Brand — RBOLA

_Status: direction PIVOTED 2026-08-29 by the founder's own design handoff (`card-assets/design/stepn-design-extracted/design_handoff_camera_screen/`). **Dark quiet-luxury champagne** is the app-wide direction. This supersedes the "Turbo Sticker" palette locked 2026-08-27 (founder reopened it herself with a new design artifact — full pivot confirmed in session 2026-08-29). Applied to the app starting with the camera screen._

## Direction (founder's design, 2026-08-29)

**Quiet luxury, matte and desaturated.** Near-black canvas, warm white text, champagne gold as the *only* accent. Elegance comes from hairlines (.5–1px), letterspaced mono micro-caps, and spacing — never from weight, neon, glows, or gradients (the only gradients allowed are legibility scrims). The founder authored the reference prototype herself ("StepN-style NFT hero app"); its README is the binding spec, delivered screen-by-screen. Camera screen handoff = fidelity **final, pixel-perfect**.

The Turbo-gum-sticker heritage may still live in the *card artwork* language (gum-insert card anatomy per `brand-direction.md`) — but the app chrome is dark champagne. Don't re-litigate.

## Name

**RBOLA** (always all-caps in Latin) paired with **რბოლა** (Georgian, "race"). Pronunciation "r-BO-la". "RBOLA!" stamps the screen on a successful catch.

## Palette — dark champagne (dark is home base)

| Token | Value | Use |
|---|---|---|
| `background` | `#0A0A0F` | Near-black canvas (app + page bg outside mobile column) |
| scanner bg | `#07070A` | Camera screen base |
| `surface` | `#15151A` / `#15151C` | Graphite raised surfaces, idle shutter disc |
| `foreground` | `#F2F1EE` | Warm white text (bright variant `#F5F4F1`) |
| `accent` | `#C9B37E` | Champagne gold — the ONLY accent (hover/bright `#E0CD9C`) |
| hairlines | `rgba(233,231,226, .09–.5)` | Borders at .5px–1px |
| muted text | `rgba(242,241,238, .3 / .34 / .4 / .7)` | Secondary text ladder |

## Typography

- UI text: `-apple-system, "SF Pro Text", system-ui, sans-serif`
- Labels/micro caps: `ui-monospace, Menlo, monospace`, 9–13px, weight 400–600, letter-spacing .13em–.3em, ALL CAPS
- **Never bold display text** — elegance from hairlines and spacing, not weight
- Carried forward: numbers/addresses always mono + tabular-nums; Georgian რბოლა needs a Georgian-capable fallback

## Shape & motion

- Radii: controls are circles; pills 20px; cards 22px
- Motion: `.25s ease` (color fills), `.3s ease` (pill expand), `.45s cubic-bezier(.36,.66,.04,1)` (flip-cam spin)
- Icons: CSS-drawn geometry or inline SVG, 1.3px strokes, currentColor — **never icon fonts**

## Usage rules

- **Gold appears sparingly** — it's the reward color (capture fill, active tab, flash-on), not decoration.
- Matte, desaturated; NO neon, no glows beyond spec'd shadows, no gradients except legibility scrims.
- Rarity = print treatment (matte → gloss → foil → holo-edge Grail), not rainbow colors.

## Voice

Race energy at the surface, collector precision at the core. Copy: short, active, specific, mono micro-caps for system messages (`REVIEW ON NEXT SCREEN`). Zero cuteness near money, rarity odds, or the marketplace. Georgian script appears as a signature (რბოლა under RBOLA), not decoration.

## History

Gunmetal/amber interim (08-26, dead) → "Turbo Sticker" warm paper (08-27, superseded) → **dark champagne (08-29, current — founder's own design)**.
