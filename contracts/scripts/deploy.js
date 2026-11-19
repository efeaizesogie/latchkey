// Tape out the latch circuit on TapeOut (OrderGuard processor) and deploy the factory.
//
//   Fork rehearsal:  npx hardhat node --fork https://rpc.xlayer.tech   (other terminal: FORK=1)
//                    npx hardhat run scripts/deploy.js --network localhost
//   X Layer:         DEPLOYER_KEY=0x... TREASURY=0x... npx hardhat run scripts/deploy.js --network xlayer
//
// Env: CIRCUIT_ID (reuse an existing tape-out), TREASURY (default: deployer), SETUP_FEE (OKB, default 0.001),
//      CLAIM_BPS (default 20 = 0.2%).
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const latch = require("../../circuit/build/latch.json");

const PROCESSOR = "0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355";
const PROC_ABI = [
  "function TAPEOUT_FEE() view returns (uint256)",
  "function transistors() view returns (address)",
  "function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "function netlist(uint256) view returns (bytes)",
  "event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)",
];
const T_ABI = [
  "function mint(uint256 id, uint256 amount) payable",
  "function mintPrice() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function balanceOf(address, uint256) view returns (uint256)",
];

async function main() {
  const live = network.name === "xlayer";
  const outName = live ? "xlayer.json" : "fork.json";
  if (network.name === "localhost") await network.provider.send("hardhat_mine", ["0x1"]);
  const [me, heir, stranger] = await ethers.getSigners();
  console.log(`network ${network.name}, deployer ${me.address}, balance ${ethers.formatEther(await ethers.provider.getBalance(me.address))} OKB`);

  const proc = new ethers.Contract(PROCESSOR, PROC_ABI, me);
  let circuitId = process.env.CIRCUIT_ID ? BigInt(process.env.CIRCUIT_ID) : null;
  if (circuitId === null) {
    const t = new ethers.Contract(await proc.transistors(), T_ABI, me);
    const [price, pfee, tapeFee] = await Promise.all([t.mintPrice(), t.protocolFee(), proc.TAPEOUT_FEE()]);
    const haveN = await t.balanceOf(me.address, 0), haveL = await t.balanceOf(me.address, 1);
    const needN = BigInt(latch.nand) > haveN ? BigInt(latch.nand) - haveN : 0n;
    const needL = BigInt(latch.latch) > haveL ? BigInt(latch.latch) - haveL : 0n;
    if (needN) await (await t.mint(0, needN, { value: price * needN + pfee })).wait();
    if (needL) await (await t.mint(1, needL, { value: price * needL + pfee })).wait();
    const rc = await (await proc.tapeout(latch.netlist, latch.nIn, latch.nOut, { value: tapeFee })).wait();
    const ev = rc.logs.map((l) => { try { return proc.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TapedOut");
    circuitId = ev.args.circuitId;
    console.log(`taped out circuit #${circuitId} (tx ${rc.hash})`);
  }
  if ((await proc.netlist(circuitId)) !== latch.netlist) throw new Error(`circuit #${circuitId} is not the Latchkey netlist`);

  const treasury = process.env.TREASURY || me.address;
  const setupFee = ethers.parseEther(process.env.SETUP_FEE || "0.001");
  const claimBps = Number(process.env.CLAIM_BPS || 20);
  const F = await ethers.getContractFactory("LatchkeyFactory");
  const factory = await F.deploy(PROCESSOR, circuitId, treasury, setupFee, claimBps);
  await factory.waitForDeployment();
  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    processor: PROCESSOR,
    circuitId: circuitId.toString(),
    factory: await factory.getAddress(),
    implementation: await factory.implementation(),
    treasury,
    setupFee: setupFee.toString(),
    claimFeeBps: claimBps,
    deployedAt: new Date().toISOString(),
    tx: factory.deploymentTransaction().hash,
  };

  if (!live) {
    // Fork rehearsal: a test USDT with balances for the three local test people.
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    await token.waitForDeployment();
    for (const s of [me, heir, stranger]) await (await token.mint(s.address, 5_000n * 10n ** 6n)).wait();
    out.token = await token.getAddress();
  }
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const prev = fs.existsSync(path.join(dir, outName)) ? JSON.parse(fs.readFileSync(path.join(dir, outName), "utf8")) : {};
  fs.writeFileSync(path.join(dir, outName), JSON.stringify({ ...prev, ...out }, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
