# Latchkey

**A vault with a latch.** Check in now and then. If you go quiet for longer than you chose, a grace period starts and you get a TapeSend message. If you still don't check in (or two of your guardians confirm you are gone), a TapeOut circuit trips the latch, and everything in the vault goes to the address you named: your own backup wallet (lost phone, lost seed) or your heir.

**Try it:** https://efeaizesogie.github.io/latchkey/ (switch the header to **Testnet** for free test tokens) · code: https://github.com/efeaizesogie/latchkey

Built for **X Layer TapeOut Accelerate** (Oct 16 – Dec 7, 2026). Everything in this repository was built during the event (started 2026-11-19).

- **Self-custodial.** You keep your keys. While the latch is open, only you can move funds.
- **No company in the middle.** The factory and vaults have no owner, no setters and no upgrade path. The state machine is a circuit taped out on TapeOut. Notices travel over TapeSend. The app is one HTML file stored on DeWEB in the circuit's own container. If we disappear, every vault still works from its `.tape` name.
- **Decided by circuits.** A vault's state can only change through `step()` on the TapeOut processor.

## How Latchkey uses the TapeOut ecosystem

| Piece | How Latchkey uses it |
|---|---|
| **TapeOut circuits (TAP-02)** | Two circuits on TapeOut's existing **OrderGuard** processor (`0x57F3…A355`, X Layer). **MAJ3** (6 NAND): two of three guardians agree. **Latch** (18 NAND + 2 LATCH + a **REF** to MAJ3), the vault's state machine: `warn' = ¬q ∧ ¬alive ∧ (warn ∨ expired)`, `q' = q ∨ (¬alive ∧ warn ∧ (graceOver ∨ MAJ3(g0,g1,g2)))`. Built and checked on all 256 (state, input) rows by `circuit/latch.mjs`. |
| **Processor `step()`** | Every check-in, poke and trip is one beat: `step(latchId, [warn, q], [expired, alive, graceOver, g0, g1, g2])`. The vault derives the six input bits from the clock and the guardians' on-chain confirmations, stores the state the circuit returns, and keeps every beat on chain (`history()`). |
| **REF composition** | The latch includes MAJ3 by REF, TapeOut's way to build chips from other chips. Only the latch's own gates are burned at tape-out. |
| **ERC-6551 container** | The latch circuit's container is Latchkey's on-chain identity: the website's home on DeWEB, and the sender of every TapeSend notice. Its NFT is held by `LatchkeyHerald`. |
| **DeWEB + TapeKit** | The app is one self-contained file in the container (`SiteRegistry.putFile`/`appendChunk`), bound as `<latch id>.2.272.tape` and served by TapeKit gateways (`https://<id>-2-272.tapekit.org/`). It passes TapeKit's "100% on-chain" static rule (`app/scripts/check-onchain.mjs`, SPEC §8), and only reads TapeKit's default X Layer nodes. |
| **TapeSend (TAP-10 messaging)** | `LatchkeyHerald` sends public TAP-10 messages from Latchkey's container via the DeWebHub: to the owner's inbox when a grace period starts (an on-chain watchtower), and to the heir's inbox when the latch trips. Inboxes are given as `.tape` names or container addresses and resolved per TAP-10 §4 (factory `cpuAt` + Opener `accountOf`). Without an inbox, the message goes to Latchkey's own inbox, a public feed. The app reads the hub's outbox and verifies each payload against its digest. |
| **TAP-10 node agreement** | Vault snapshots are read from two independent operators' nodes at the same block and compared (`readAgreed`). |
| **On-chain data** | `#/proof` asks the processor for all 256 rows live and decodes the netlist (including the REF). `#/stats` reads every vault from the factory, plus the herald's TapeSend feed. There is no database. |

## Contracts

| Contract | Role |
|---|---|
| `LatchkeyVault` | One person's vault (minimal clone). Owner: `checkIn`, `withdraw`, `setHeir`, `setTimes`, `setGuardians`, `setOwnerInbox`. Anyone: `poke` (the circuit decides: start grace / trip / revert `NothingToDo`). Guardians: `confirm` (only during a grace period). Heir: `claim`. Safety valve: `tripWithoutCircuit` only if the processor stops answering, 30 days after the latch could have tripped. |
| `LatchkeyFactory` | No owner. Creates vaults, wired to the latch circuit and the herald; fixed setup fee and claim fee (capped at 1%). Lists vaults by owner, heir and guardian. |
| `LatchkeyHerald` | Holds the latch circuit NFT and speaks over TapeSend as its container. Only factory vaults can make it speak, and only fixed messages composed from vault state. Its admin can only name a DeWEB site operator (30 days at a time, the SiteRegistry maximum) and can renounce. It holds no funds, and vaults never depend on it (`try/catch`, with gas reserved so wallet estimates can't starve it). |

## Deployments

**X Layer testnet (1952), live now:**

| | Address |
|---|---|
| Tap02Processor (TAP-02 evaluator standing in for TapeOut) | `0xDD7Db4b4DD2b78aE6E4CB70EaFF8264df1023Ca4`: latch #2, MAJ3 #1 |
| LatchkeyFactory | `0xe62017acdF3fad73FAAB30216906aE712f7Ebe29` |
| TestUSD (tUSDT0 faucet) | `0x409A89585C1095666579A523e0fABF96689095c8` |
| Verified journey | vault `0x3cE45a8E5F16E990aaB21eD0Cb942A626599f405`: grace, trip, heir claimed 99.8 tUSDT0 |

**X Layer mainnet (196):**

| | |
|---|---|
| Processor | OrderGuard `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355` |
| MAJ3 circuit ID | _filled after tape-out_ (`contracts/deployments/xlayer.json`) |
| Latch circuit ID | _filled after tape-out_ |
| LatchkeyFactory / LatchkeyHerald | _filled after deploy_ |
| DeWEB | _`<id>.2.272.tape` after publish_ |

## Testnet (free, for anyone and for judges)

TapeOut, TapeSend and DeWEB exist only on X Layer mainnet. So that anyone can try Latchkey without money, the same
contracts also run on **X Layer testnet (chain 1952)**:

- `contracts/contracts/testnet/Tap02Processor.sol` stands in for a TapeOut processor. It stores the same TAP-02
  netlists and evaluates them (NAND, LATCH, REF, TAP-02 bit packing) behind the same `step()` interface.
  `test/testnet.test.js` checks it against TapeOut's real OrderGuard processor on a mainnet fork, on all 256 rows
  of the latch plus packing edge cases, and runs the unchanged vault end to end on it.
- `LatchkeyFactory` / `LatchkeyVault` are byte-for-byte the mainnet contracts. There is no herald on testnet,
  so no TapeSend notices, and the setup fee is 0.
- `TestUSD` (tUSDT0) gives anyone 1,000 test dollars per hour.
- In the app, the header's network switch picks **Testnet**: a banner links the official OKB faucet
  (web3.okx.com/xlayer/faucet) and has a "Get 1,000 tUSDT0" button. Testnet also offers 3-minute windows and
  1-minute grace periods, so a latch can be watched tripping in minutes.

```bash
cd contracts
node scripts/testnet-wallet.js                                   # makes a testnet-only deployer (key in .env.testnet)
# fund the printed address from https://web3.okx.com/xlayer/faucet, then:
npx hardhat run scripts/deploy-testnet.js --network xlayerTestnet  # about 0.01 test OKB
```

## Repository

```
circuit/            netlist builder (NAND, LATCH, REF), TAP-02 evaluator, exhaustive check
contracts/          LatchkeyVault, LatchkeyFactory, LatchkeyHerald; fork tests against the real TapeOut contracts
  scripts/          deploy.js, publish-deweb.js, rehearse.js, lib/tapeout.js, research/ (container probe)
app/                Vite + Preact + viem, mobile first; builds to one self-contained index.html
DESIGN.md           design direction (Refero: Mercury + Linear)
SUBMISSION.md       form answers and demo script
```

## Run it

```bash
node circuit/latch.mjs                          # build + verify both netlists (256/256 rows)

cd contracts && npm i
npm run test:fork                               # X Layer fork: tape-out, REF, Opener, TapeSend hub, SiteRegistry

# local rehearsal on a fork of X Layer
FORK=1 npx hardhat node                         # terminal 1
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/rehearse.js --network localhost   # optional: a vault that went through the whole journey
cd ../app && npm i && npm run dev               # http://localhost:5173 (fork mode: test people, clock skip)
```

Mainnet (about 0.09 OKB in a fresh deployer wallet; key in `contracts/.env`, see `.env.example`):

```bash
cd contracts && npx hardhat run scripts/deploy.js --network xlayer         # tape-outs, container, name, herald, factory
cd ../app && LK_ONCHAIN=1 npx vite build && node scripts/check-onchain.mjs  # on-chain build, purity check
cd ../contracts && npx hardhat run scripts/publish-deweb.js --network xlayer
```

## Tests (fork of X Layer mainnet, real TapeOut contracts)

- Both netlists are stored as built. The latch's gate count includes MAJ3's gates through REF.
- The real processor's `step()` matches the specification on all 256 (state, input) rows.
- Journey: grace period starts (TapeSend notice to Latchkey's feed), owner check-in cancels it, grace starts again, one guardian is not enough, two trip the latch (TapeSend notice to the heir's inbox, with the `tape://` link), irreversibility, heir claim with the fee split. Sent with **wallet-estimated gas**, so the notices are proven to go out in real conditions.
- Without guardians, the latch trips only after the grace period.
- Owner controls and validation; herald access rules; the herald as holder can name a SiteRegistry operator who uploads a file; no re-initialisation; the factory refuses a wrong circuit.
- Safety valve: with the processor's code replaced by a reverting stub, the owner can still withdraw and the heir is never locked out.
- DeWEB publish rehearsed on a fork: chunks read back with a matching SHA-256.

Gas on X Layer (0.02 gwei): create about 617k, check-in about 227k, poke with a TapeSend notice about 460k, confirm about 50k, claim about 110k. Each is well under a cent.

## Fees (fixed at deploy; nobody can change them)

- Setup: 0.001 OKB per vault.
- Claim: 0.2% of what the heir claims (capped at 1% in the contract).

## Security notes

Unaudited hackathon code. Known trade-offs:
- Anyone may `poke()`. That is the point: no keeper or company is needed. The circuit decides.
- A check-in before the trip always wins. Guardians can only shorten a grace period that has already started.
- TapeOut's processor is a beacon proxy (the circuits are frozen per the TapeSend README, 2026-10-22). If it ever stopped answering, the safety valve above applies.
- TapeSend messages are public (metadata and content). They contain vault and wallet addresses, never amounts.

MIT licensed.
