# Latchkey: submission kit (X Layer TapeOut Accelerate)

Draft, 2026-11-19. Placeholders in `[brackets]` get filled in after the mainnet deploy. The user submits the Google Form (forms.gle/EoDNbxQ65dev1wFd9).

## One line

A self-custodial vault that opens for your backup wallet or your heir if you stop checking in. The latch is a TapeOut circuit, and the app lives on X Layer DeWEB, so it can't disappear before you do.

## Form fields (draft answers)

- **Project name:** Latchkey
- **Processor contract address:** 0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355 (TapeOut OrderGuard, X Layer)
- **Circuit ID:** [#]
- **Other contracts:** LatchkeyFactory [0x…]
- **Access link:** https://[id]-2-272.tapekit.org/ (on-chain: tape://[id].2.272.tape)
- **Repo:** https://github.com/[user]/latchkey
- **Demo video:** [YouTube link]

### Product / service

Latchkey is a dead man's switch for crypto. You create a vault, name a receiver and pick a silence window (30 days to a year). You check in with one tap. If you go quiet for longer than your window, anyone can trip the latch, and from then on only the receiver can claim what is in the vault.

The latch is a 4-NAND + 1-LATCH circuit taped out on TapeOut. Every check-in and every trip is one `step()` of that circuit, and once the bit is 1 it can never go back to 0. The vault contract only feeds the circuit two bits (expired, alive) and stores what the circuit returns. There is no admin key, no upgrade and no server. The app itself is one HTML file stored in the circuit's ERC-6551 container on DeWEB. If our company, domain and servers vanish, the same vault still works from its `.tape` name.

### Target users

1. **Self-recovery (the selfish case, the bigger market).** Anyone holding crypto on a single phone. Lost phones, broken phones, forgotten seed phrases: about 20% of all BTC is believed lost, mostly to lost keys and deaths. Latchkey makes a backup wallet you keep elsewhere the receiver, so losing your main wallet costs you a waiting period instead of your savings.
2. **Inheritance.** Families in high-adoption markets who save in stablecoins. Nigeria is the lead market: about 80% of crypto-active Nigerians hold USDT as savings, and most have no plan for who gets it.
3. **Small teams and DAOs.** A treasury that falls back to a multisig if the operator goes dark.

### How we reach them

- **OKX and X Layer distribution first:** the vault address works as a withdrawal address, so "withdraw from OKX straight into your vault on X Layer" is a one-screen tutorial. Ask for placement in the OKX Wallet Discover tab and X Layer ecosystem pages (offered to winners).
- **Creator-led content in Lagos/Nairobi/Manila crypto Twitter, TikTok and WhatsApp communities:** "what happens to your USDT if you lose your phone?" A 30-second video of the bit flipping is the hook.
- **Partners who already talk about estates:** lawyers, wealth planners, P2P merchants and savings communities, with a referral cut of the setup fee.
- **The heir is the next user:** every vault sends a link to someone who has never heard of Latchkey.

### Revenue model

- **Setup fee:** 0.001 OKB per vault (fixed in the contract; tiered pricing later per factory).
- **Claim fee:** 0.2% of what the receiver claims, paid automatically at claim (capped at 1% in the contract). Charged only when the product does its job.
- **Watchtower subscription (next):** reminders by email, Telegram and SMS before the window runs out, and a heads-up to the heir. This is the paid layer on top of the free calendar reminders shipped today. It is optional, because the vault never depends on it.
- **B2B:** white-label factories for wallets and exchanges ("inheritance for your users"), with a revenue share on the claim fee.

### Why users pay and stay

- The cost is tiny next to the risk (a lost seed phrase), and you pay the big part only when it saves you.
- Every check-in is a reason to come back: a calm, 3-second ritual with a visible streak, and calendar reminders built in.
- Funds stay in the user's own contract, and leaving is free (withdraw any time while open). Trust comes from not being trapped.
- Every vault brings a second person (the receiver) into the product.

### TapeOut ecosystem integration

- **TapeOut circuit:** custom TAP-02 netlist, taped out on the OrderGuard processor, called on every beat via `step()`. The latch state that matters to users is the circuit's state.
- **ERC-6551 container + DeWEB + TapeKit:** the app lives in the circuit's container (SiteRegistry), bound as `[id].2.272.tape` and served by TapeKit.
- **On-chain data:** the app's proof page reads the netlist and calls `step()` live for all 8 rows of the truth table.

## Demo video script (≤ 3:00, 1080p, screen capture + voice)

| Time | Picture | Voice |
|---|---|---|
| 0:00–0:15 | Black. One line types: "About 20% of all bitcoin is lost." Then a phone falls. | "Lose your phone and your seed phrase, and your crypto is gone. Die without a plan, and your family never sees it." |
| 0:15–0:30 | Landing page on a phone (tapekit URL visible). | "Latchkey is a vault with a latch. Check in now and then. Go quiet for too long, and it opens for your backup wallet or the person you choose." |
| 0:30–1:05 | Create: receiver, window ("3 minutes" for the demo), review sentence, create; fund with USDT0 from OKX Wallet. | "Name who it opens for, pick how long a silence means something is wrong, fund it. You keep the keys and can take everything back while it's open." |
| 1:05–1:20 | Dashboard: ring, Check in, history row "0 · 01 → 0". | "Checking in is one tap. Each one is a beat of a TapeOut circuit on X Layer." |
| 1:20–1:45 | Proof page: gates, truth table "8/8 match the processor". | "The latch isn't a flag in our database. It's four NAND gates and one latch, taped out on TapeOut: q-next equals q, or expired-and-not-alive. Once it's one, it's one forever." |
| 1:45–2:15 | Timer runs out; a second phone (a stranger) taps "Trip the latch"; the bit rolls to 1 in brass; OKLink tx. Heir phone: "This vault is yours to claim" → Claim → wallet balance. | "I stopped checking in. Anyone can now trip it. No keeper, no company. The circuit flips the bit, and my heir claims." |
| 2:15–2:40 | Normal domain shows 404 ("we deleted our company, domain and servers"). Same vault opens at `[id]-2-272.tapekit.org`, still works. | "Now we delete our company, domain and servers. The normal link is dead. The vault, and this app, still live on X Layer, at its on-chain name." |
| 2:40–3:00 | Revenue line + users. End card: Latchkey, tape:// name. | "A small setup fee, 0.2% only when it pays out, and an optional reminder service. Built for the eighty percent of Nigerian crypto users who save in dollars. Latchkey: it can't disappear before you do." |

## Demo Day

Location not yet published. Ask in the TapeOut Telegram (user).
