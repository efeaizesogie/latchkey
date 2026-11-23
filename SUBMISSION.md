# Latchkey: submission kit (X Layer TapeOut Accelerate)

Draft, updated 2026-11-23 (v2: grace period, guardians, TapeSend). Placeholders in `[brackets]` get filled in after the mainnet deploy. The user submits the Google Form (forms.gle/EoDNbxQ65dev1wFd9).

## One line

A self-custodial vault that opens for your backup wallet or your heir if you stop checking in. Its state machine is a TapeOut circuit, its notices travel over TapeSend, and the app lives on X Layer DeWEB, so it can't disappear before you do.

## Form fields (draft answers)

- **Project name:** Latchkey
- **Processor contract address:** 0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355 (TapeOut OrderGuard, X Layer)
- **Circuit IDs:** latch [#] (REFs MAJ3 [#])
- **Other contracts:** LatchkeyFactory [0x…], LatchkeyHerald [0x…]
- **Access link:** https://efeaizesogie.github.io/latchkey/ (testnet live now). After the mainnet launch, also on chain at https://[id]-2-272.tapekit.org/ (tape://[id].2.272.tape)
- **Repo:** https://github.com/efeaizesogie/latchkey
- **Demo video:** [YouTube link]

- **Testnet (free, for judges):** X Layer testnet (chain 1952). Factory `0xe62017acdF3fad73FAAB30216906aE712f7Ebe29`, TAP-02 evaluator `0xDD7Db4b4DD2b78aE6E4CB70EaFF8264df1023Ca4` (latch #2, MAJ3 #1), test dollars tUSDT0 `0x409A89585C1095666579A523e0fABF96689095c8`. In the app, switch the header to **Testnet**: get test OKB from the official faucet, tap "Get 1,000 tUSDT0", and pick the 3-minute window to watch a latch trip in minutes. A live end-to-end run (create → deposit → grace → trip → heir claims 99.8 tUSDT0) is vault `0x3cE45a8E5F16E990aaB21eD0Cb942A626599f405`.

### Product / service

Latchkey is a dead man's switch for crypto. You create a vault, name a receiver (your own backup wallet or your heir), and pick a silence window (30 days to a year) and a grace period. You check in with one tap. If you go quiet past your window, anyone can start the grace period, and you get a TapeSend message. One check-in cancels it. If you stay quiet until the grace period ends, or two of your up-to-three guardians confirm you are gone, the latch trips. From then on, only the receiver can claim what is inside, and they get a TapeSend message too.

The state machine is a TapeOut circuit: 18 NAND + 2 LATCH, with a REF to a second taped-out circuit (MAJ3, 2 of 3 guardians). Every check-in, poke and trip is one `step()` of that circuit. A trip always needs a grace period first, a check-in before the trip always wins, and once the latch bit is 1 it can never go back. The vault contract only derives six input bits from the clock and the guardians' confirmations, and stores what the circuit returns. Funds sit in the user's own vault contract, and nobody has admin power over vaults or funds. The app is one HTML file stored in the latch circuit's ERC-6551 container on DeWEB. That same container sends the TapeSend notices. If our company, domain and servers vanish, every vault still works from its `.tape` name.

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

- **TapeOut circuits + processor:** two TAP-02 circuits taped out on the OrderGuard processor. The latch REFs MAJ3 (TapeOut's composition model). Every vault beat calls `step()`, and the app re-checks all 256 (state, input) rows against the processor live.
- **ERC-6551 container:** the latch circuit's container is Latchkey's identity, holding the website and sending the messages. The circuit NFT is held by the herald contract.
- **DeWEB + TapeKit:** the app is stored in that container, bound as `[id].2.272.tape`, and served by TapeKit gateways. It passes TapeKit's "100% on-chain" static rule and reads only TapeKit's default X Layer nodes, with TAP-10 two-node agreement for vault reads.
- **TapeSend:** public TAP-10 messages from Latchkey's container: to the owner's inbox when a grace period starts (an on-chain watchtower), and to the heir's inbox when the latch trips. Inboxes are entered as `.tape` names (TAP-10 name resolution). The app reads the hub outbox and verifies payload digests.
- **On-chain data:** the stats page and history come straight from the factory, the vaults and the hub; there is no database.

## Demo video script (≤ 3:00, 1080p, screen capture + voice)

| Time | Picture | Voice |
|---|---|---|
| 0:00–0:12 | Black. One line types: "About 20% of all bitcoin is lost." A phone falls. | "Lose your phone and your seed phrase, and your crypto is gone. Die without a plan, and your family never sees it." |
| 0:12–0:25 | Landing page on a phone (tapekit URL visible). | "Latchkey is a vault with a latch. Check in now and then. Go quiet for too long, and it opens for your backup wallet or the person you choose." |
| 0:25–0:55 | Create: receiver with their `.tape` inbox, window and grace (demo: 3 min + 1 min), two guardians, review sentence, create; deposit USDT0. | "Name who it opens for, how long a silence means something is wrong, a grace period, and up to three guardians. You keep the keys, and you can take everything back while it's open." |
| 0:55–1:10 | Dashboard ring, Check in; history row "open → open, alive". | "Checking in is one tap. Each one is a beat of a TapeOut circuit on X Layer." |
| 1:10–1:35 | Proof page: equations, REF diagram, "256/256 rows match the processor". | "The latch isn't a flag in our database. It's a circuit taped out on TapeOut, built from another circuit by REF, and your browser checks all 256 cases against the processor live. Once it trips, it can never be undone." |
| 1:35–2:10 | Window runs out; a stranger taps "Start the grace period" and the TapeSend notice appears. Two guardians confirm on their phones; "Trip the latch"; the bit rolls to brass 1. The heir's TapeSend inbox shows "a vault has opened for you"; Claim. | "I stopped checking in. Anyone can start the grace period, and Latchkey tells me over TapeSend. My guardians confirm, the circuit flips the bit, and my heir gets a TapeSend message and claims. No keeper, no company." |
| 2:10–2:35 | Normal domain 404s ("we deleted our company, domain and servers"). The same vault opens at `[id]-2-272.tapekit.org` with TapeKit's on-chain badge. | "Now we delete our company, domain and servers. The normal link is dead. The vault, the notices and this app still live on X Layer, at its on-chain name." |
| 2:35–3:00 | Stats page; revenue line; end card with the `tape://` name. | "A small setup fee, 0.2% only when it pays out, and an optional reminder service. Built for the eighty percent of Nigerian crypto users who save in dollars. Latchkey: it can't disappear before you do." |

## Demo Day

Location not yet published. Ask in the TapeOut Telegram (user).
