// Research probe (fork only): can a TapeOut circuit's ERC-6551 container be created through the canonical
// registry and used (receive + execute) WITHOUT paying the Opener's one-time fee?
//   FORK=1 npx hardhat run scripts/research/probe-container.js
// Result 2026-11-23: createAccount via the registry works and the container can receive funds, but execute()
// reverts NotPaid() until the Opener fee (0.08 OKB) is paid. So vault funds live in LatchkeyVault, not a container.
const { ethers, network } = require("hardhat");
const latch = require("../../../circuit/build/latch.json");

const P = "0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355";
const R = "0x000000006551c19487814612e58FE06813775758";
const I = "0xAC4F791353eE9F06e2C50Ae4C34680D28Ea52a57";
const O = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";

async function main() {
  await network.provider.send("hardhat_mine", ["0x1"]);
  const [me, other] = await ethers.getSigners();
  const proc = new ethers.Contract(P, [
    "function TAPEOUT_FEE() view returns (uint256)", "function transistors() view returns (address)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)",
  ], me);
  const t = new ethers.Contract(await proc.transistors(), ["function mint(uint256,uint256) payable", "function mintPrice() view returns (uint256)", "function protocolFee() view returns (uint256)"], me);
  const [price, pfee] = [await t.mintPrice(), await t.protocolFee()];
  await (await t.mint(0, 4, { value: price * 4n + pfee })).wait();
  await (await t.mint(1, 1, { value: price + pfee })).wait();
  const rc = await (await proc.tapeout(latch.netlist, 2, 1, { value: await proc.TAPEOUT_FEE() })).wait();
  const id = rc.logs.map((l) => { try { return proc.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "TapedOut").args.circuitId;

  const reg = new ethers.Contract(R, ["function createAccount(address,bytes32,uint256,address,uint256) returns (address)", "function account(address,bytes32,uint256,address,uint256) view returns (address)"], me);
  const opener = new ethers.Contract(O, ["function accountOf(address,uint256) view returns (address)", "function isOpened(address,uint256) view returns (bool)"], me);
  const acc = await reg.account(I, ethers.ZeroHash, 196, P, id);
  console.log("circuit", id.toString(), "container", acc, "== opener.accountOf:", acc === (await opener.accountOf(P, id)));
  await (await reg.createAccount(I, ethers.ZeroHash, 196, P, id)).wait();
  console.log("created without opener; code bytes:", ((await ethers.provider.getCode(acc)).length - 2) / 2, "isOpened:", await opener.isOpened(P, id));
  await (await me.sendTransaction({ to: acc, value: ethers.parseEther("0.01") })).wait();
  console.log("funded:", ethers.formatEther(await ethers.provider.getBalance(acc)));

  const tries = [
    ["execute(address,uint256,bytes,uint8)", ["function execute(address,uint256,bytes,uint8) payable returns (bytes)"], (c) => c.execute(other.address, ethers.parseEther("0.001"), "0x", 0)],
    ["executeCall(address,uint256,bytes)", ["function executeCall(address,uint256,bytes) payable returns (bytes)"], (c) => c.executeCall(other.address, ethers.parseEther("0.001"), "0x")],
  ];
  for (const [name, abi, fn] of tries) {
    const c = new ethers.Contract(acc, abi, me);
    try { await (await fn(c)).wait(); console.log("OK  ", name, "balance now", ethers.formatEther(await ethers.provider.getBalance(acc))); }
    catch (e) { console.log("FAIL", name, (e.shortMessage || e.message).slice(0, 160)); }
  }
  for (const f of ["function token() view returns (uint256,address,uint256)", "function owner() view returns (address)", "function state() view returns (uint256)"]) {
    const c = new ethers.Contract(acc, [f], me);
    const n = f.split(" ")[1].split("(")[0];
    try { console.log(n, (await c[n]()).toString()); } catch (e) { console.log(n, "n/a"); }
  }
  // non-holder must fail
  try { await (await new ethers.Contract(acc, ["function execute(address,uint256,bytes,uint8) payable returns (bytes)"], other).execute(other.address, 1, "0x", 0)).wait(); console.log("!! non-holder executed"); }
  catch { console.log("non-holder execute refused (good)"); }
}
main().catch((e) => { console.error(e); process.exit(1); });
