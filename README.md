# Latchkey

**A vault with a latch.** Check in now and then. If you go quiet for longer than you chose, a TapeOut circuit trips the latch, and everything in the vault goes to the address you named: your own backup wallet (lost phone, lost seed) or your heir.

Built for **X Layer TapeOut Accelerate** (Oct 16 – Dec 7, 2026). Everything in this repository was built during the event (started 2026-11-19).

- **Self-custodial.** You keep your keys. While the latch is open, only you can move funds.
- **No company in the middle.** The factory has no owner, no setters and no upgrade path. The latch is a circuit taped out on TapeOut. The app is one HTML file stored on X Layer DeWEB in the circuit's own container. If we disappear, the vault still works from its `.tape` name.
- **Decided by a circuit.** The latch bit can only change through `step()` on the TapeOut processor.

## How TapeOut is used

| Piece | What it is |
|---|---|
| Circuit | `circuit/latch.mjs`: a TAP-02 netlist of 4 NAND + 1 LATCH (32 bytes). Inputs `expired`, `alive`; state `q`; output `q' = q OR (expired AND NOT alive)`. Once 1, it stays 1 forever. |
| Processor | Taped out on TapeOut's existing **OrderGuard** processor `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355` (X Layer, chain 196). |
| Vault | `contracts/contracts/LatchkeyVault.sol`. Every check-in and every trip is one beat: `processor.step(circuitId, [latch], [expired, alive])`. The vault stores the new state the circuit returns and keeps every beat on chain (`history()`). |
| ERC-6551 container + DeWEB | The circuit's container stores the app (`SiteRegistry.putFile` / `appendChunk`), activated as `<circuit>.2.272.tape` and served by TapeKit gateways (`https://<circuit>-2-272.tapekit.org/`). |
| Proof page | `#/proof` in the app calls `step()` live for all 8 rows of the truth table and decodes the netlist read from the processor. |

The deadline check (`block.timestamp >= lastCheckIn + window`) runs in the vault contract and enters the circuit as the `expired` bit, as the event FAQ allows ("logic may run outside circuits").

## Deployments

| | X Layer mainnet (196) |
|---|---|
| Processor | OrderGuard `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355` |
| Circuit ID | _filled after tape-out_ (`contracts/deployments/xlayer.json`) |
| LatchkeyFactory | _filled after deploy_ |
| DeWEB | _filled after publish_ |

## Repository

```
circuit/      TAP-02 netlist builder, evaluator and exhaustive check (node circuit/latch.mjs)
contracts/    LatchkeyVault, LatchkeyFactory, fork tests against the real processor, deploy + DeWEB publish scripts
app/          Vite + Preact + viem, mobile first; builds to one self-contained index.html
DESIGN.md     design direction (Refero: Mercury + Linear)
```

## Run it

```bash
node circuit/latch.mjs                          # build + verify the netlist (8/8 rows, never clears)

cd contracts && npm i
npm run test:fork                               # taped out on an X Layer fork; full journey on the real processor

# local rehearsal: a fork of X Layer with Latchkey deployed
FORK=1 npx hardhat node                         # terminal 1
npx hardhat run scripts/deploy.js --network localhost
cd ../app && npm i && npm run dev               # http://localhost:5173 (fork mode, test people, clock skip)
```

Mainnet (needs about 0.1 OKB in a fresh deployer wallet):

```bash
cd contracts
DEPLOYER_KEY=0x... npx hardhat run scripts/deploy.js --network xlayer         # tape out + factory
cd ../app && LK_ONCHAIN=1 npx vite build                                         # on-chain build
cd ../contracts && DEPLOYER_KEY=0x... npx hardhat run scripts/publish-deweb.js --network xlayer
```

## Tests

- `circuit`: all 8 (q, expired, alive) rows match the specification. From q = 1, no input clears the latch.
- `contracts` (fork of X Layer mainnet, real OrderGuard processor): the stored netlist equals ours; the processor's `step()` matches the truth table; the full journey (create, fund, check in, rescue after the deadline, trip, irreversibility, heir claim with fee split); owner controls; no re-initialisation; the safety valve with a dead processor; the factory refuses a wrong circuit and fees above 1%.
- DeWEB publish rehearsed on a fork: 466,551 bytes in 20 chunks, read back with a matching SHA-256.

Gas on X Layer at 0.02 gwei: create a vault about 425k gas, check-in 133k, trip 114k, claim 112k. Each costs well under a cent.

## Fees (fixed at deploy, no admin can change them)

- Setup: 0.001 OKB per vault.
- Claim: 0.2% of what the heir claims (capped at 1% in the contract).

## Security notes

Unaudited hackathon code. Known trade-offs:
- Anyone may call `trip()` after the deadline. That is the point: no keeper or company is needed.
- A check-in that lands before the trip always wins, even after the deadline.
- The heir list in the factory (`vaultsForHeir`) records the heir at creation; the vault's own `heir()` is authoritative.
- TapeOut's processor is a beacon proxy whose implementation can still change until TapeOut seals its factory. If the processor ever stops answering (the call fails, as opposed to answering 0), check-ins and trips revert with `CircuitFailed`, but the owner can still `withdraw`, and 30 days after the deadline anyone can call `tripWithoutCircuit()` so the heir is never locked out. Tested on the fork by replacing the processor's code with a reverting stub.

MIT licensed.
