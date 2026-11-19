# Latchkey — design direction

Written 2026-11-19, before any app code.

## Brand brief

Latchkey is a vault for one person's crypto that hands itself to a chosen address if that person goes quiet: the heir, or a backup wallet of their own after a lost phone. People open it on a phone, often in Lagos, holding USDT as savings. It must feel like a **bank vault door, not a casino**: quiet, exact, permanent. Every screen answers one question: *is my latch still open, and how long until it isn't?* The one action on a visit is **Check in** (owner) or **Claim** (heir).

## References (Refero Styles)

| Reference | URL | What we borrow |
|---|---|---|
| Mercury: "Alpine banking at blue hour" | https://styles.refero.design/style/3172cd4d-118a-4a16-a259-6b634d32322e | Near-black blue-violet canvas with graphite cards one step lighter, no shadows. Ivory text, never pure white. Measured mid-weight headings (480, never bold). Pill controls, 12px cards. One chromatic colour, used only for the primary action. Spacious rhythm. |
| Linear: "midnight precision instrument" | https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1 | Instrument-panel precision: hairline borders instead of fills, tight negative tracking on big numbers, mono for machine data. The accent acts as a "flashlight": small, high contrast, rare. Product UI (here, the circuit and the countdown) is the only texture. |

We surveyed the Framer fintech marketplace (https://www.framer.com/marketplace/templates/category/fintech/). Its templates are light-themed landing pages or neon crypto. We take nothing from them: the two Refero systems already cover tone and layout. We never copy a referenced brand's logo, copy or imagery.

## Tokens

```css
:root {
  /* surfaces (Mercury) */
  --canvas:   #15151d;   /* page */
  --card:     #1c1c27;   /* graphite card, one step up */
  --raised:   #262634;   /* inputs, secondary buttons */
  --hair:     #2f2f3e;   /* hairline borders (Linear) */
  --hair-hi:  #4a4a5a;
  /* text */
  --ink:      #ececf2;   /* ivory, primary */
  --ink-2:    #b9b9c6;   /* ash, secondary */
  --ink-3:    #7c7c8c;   /* fog, meta */
  /* the one accent: brass, the colour of a key */
  --brass:    #e9b44c;
  --brass-ink:#1a1407;   /* text on brass */
  --brass-dim:rgba(233,180,76,.14);
  /* states use brightness and shape, not new hues */
  --ok:       var(--ink);
  --warn:     var(--brass);
  --radius-card: 14px;
  --radius-pill: 999px;
  --font-display: "Archivo", system-ui, sans-serif;   /* wdth 112, weight 500 */
  --font-body: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}
```

- **Type:** display is Archivo at width 112 and weight 500, slightly wide (Mercury's architectural feel), tracking -0.01em. Body is Geist 400/500 at 16px with line-height 1.5. Mono is Geist Mono for addresses, block numbers, bits and netlists. Big numbers (countdown, balance) use tabular figures and tracking -0.03em (Linear).
- **Scale:** 12 / 14 / 16 / 20 / 28 / 40 / 64. Spacing on a 4px base: card padding 20px on phone and 32px on desktop, section gap 56px on phone and 72px on desktop.
- **Accent rule:** brass appears on at most **one** filled element per screen (the primary button) plus the latch bit itself. Never decorative.
- **No red, no green.** A tripped latch is shown by the bit filling with brass and the copy changing, not by an alarm colour. Errors use ink text and a hairline brass border.

## Signature element: the latch bit

A single square cell, 1 bit, drawn like an engraved register. It is open (`0`: hollow outline, ivory 0) or tripped (`1`: solid brass, dark 1). It always carries its proof beside it: "circuit #N on processor OrderGuard · step() at block X". It appears small in the header of every vault screen and huge (180px) on the dashboard and claim screens. The flip animation is a 400ms vertical roll of the digit with a single-frame brass flash. Respect `prefers-reduced-motion`: crossfade instead.

Second element: the **countdown ring**, a thin 2px hairline circle that empties as the window runs out. Its stroke is ink and becomes brass in the final 10%.

## Screens (mobile first, 375px)

1. **Landing (hook).** Full-height. The headline asks one question: "Who gets your crypto if you lose your phone tomorrow?" The live latch bit of the demo vault ticks in the hero. One brass button: "Set a latch". The explanation comes on the next scroll: three graphite cards (Check in / Go quiet / It opens for your backup), then "Lives on-chain: this page itself is served from X Layer" with the `.tape` name in mono.
2. **Create (3 steps, one card each).** (a) Who receives it: a "My backup wallet" or "My heir" toggle, then an address field (pill input, paste button). (b) Inactivity window: chips for 30 / 90 / 180 / 365 days, plus a grace period. (c) Review: a plain-English sentence ("If you don't check in for 90 days, anyone can trip the latch and 0x12…ab can claim everything in this vault"), then "Create vault".
3. **Fund.** The vault address with a QR, plus "Deposit USDT0 / OKB" buttons (one primary). The balance updates live.
4. **Dashboard (owner).** Countdown ring with "73 days left" and the latch bit. Brass "Check in" button. Below: balances, heir, window, a history list (check-ins, deposits) in mono with block numbers and explorer links. Secondary actions (change heir, withdraw, close) sit in a hairline list.
5. **Watch / poke (anyone).** The public vault page. Once the deadline passes it shows "This latch can be tripped" and a "Trip the latch" button. Tripping calls the circuit and the bit flips live.
6. **Claim (heir).** The tripped bit at 180px, "This vault is yours to claim", the amounts, and a brass "Claim to my wallet" button. Afterwards: a receipt card with tx links.
7. **Proof.** The circuit's netlist drawn as gates (NAND x N + LATCH), its truth table, the processor address and the `step()` inputs and outputs of the last trip. This is the "don't trust us" page.

## Story for the landing page

hook (fear of lost keys) → curiosity (a bit that flips by itself) → meaning (no company in the middle; the page and the vault are both on-chain) → desire (set it in 60 seconds, for the price of a coffee) → action (Set a latch).

## Do / Don't

Do
- Keep one brass element per screen, and give every number its unit and source (block, tx).
- Write plain English for the heir: they may never have used a wallet. Explain each step in a sentence before the button.
- Use hairline borders and the one-step card lift for structure. No shadows, no glass blur except the sticky header.
- Make tap targets ≥ 44px, keep a 16px gutter, and never scroll sideways.
- Keep everything self-contained (fonts subset and inlined for the DeWEB build: no https:// references, so the site gets TapeKit's "100% on-chain" badge).

Don't
- No gradients, glows, purple-blue "AI" washes, emoji, or 3D coins.
- No bold (700+) headings. Archivo 500 is the ceiling.
- No red/green status colours. No countdown in a scary red.
- Never imply custody: Latchkey never holds keys. The copy says "your vault contract", not "our vault".
