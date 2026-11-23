// Shared by the fork tests and the deploy script: tape out MAJ3, then the Latchkey latch (which REFs MAJ3),
// and open the latch circuit's container (TapeOut's one-time fee) so it can host the site and send TapeSend messages.
const { ethers } = require("hardhat");

const PROCESSOR = "0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355"; // OrderGuard, X Layer
const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";
const HUB = "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee"; // TapeSend (DeWebHub)
const SITES = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6"; // SiteRegistry
const BINDING = "0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9"; // DomainBinding

const PROC_ABI = [
  "function TAPEOUT_FEE() view returns (uint256)",
  "function transistors() view returns (address)",
  "function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function netlist(uint256) view returns (bytes)",
  "function step(uint256 id, bytes state, bytes inputs) view returns (bytes, bytes)",
  "function ownerOf(uint256) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)",
];
const T_ABI = [
  "function mint(uint256 id, uint256 amount) payable",
  "function mintPrice() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function balanceOf(address, uint256) view returns (uint256)",
];
const OPENER_ABI = [
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function isOpened(address circuits, uint256 tokenId) view returns (bool)",
  "function open(address circuits, uint256 tokenId) payable returns (address)",
  "function FEE() view returns (uint256)",
];

/**
 * @param signer  pays and becomes the holder of both circuit NFTs
 * @param opts    { majId?, latchId? to reuse earlier tape-outs, open?: false to skip opening, log? }
 */
async function tapeOutLatchkey(signer, opts = {}) {
  const log = opts.log ?? (() => {});
  const { buildMaj3, buildLatch, decode } = await import("../../../circuit/latch.mjs");
  const proc = new ethers.Contract(PROCESSOR, PROC_ABI, signer);
  const t = new ethers.Contract(await proc.transistors(), T_ABI, signer);
  const [price, pfee, tapeFee] = await Promise.all([t.mintPrice(), t.protocolFee(), proc.TAPEOUT_FEE()]);
  const bal0 = await ethers.provider.getBalance(signer.address);
  const hex = (b) => ethers.hexlify(b);

  const ensureTransistors = async (nand, latch) => {
    const [haveN, haveL] = [await t.balanceOf(signer.address, 0), await t.balanceOf(signer.address, 1)];
    const needN = BigInt(nand) > haveN ? BigInt(nand) - haveN : 0n;
    const needL = BigInt(latch) > haveL ? BigInt(latch) - haveL : 0n;
    if (needN) await (await t.mint(0, needN, { value: price * needN + pfee })).wait();
    if (needL) await (await t.mint(1, needL, { value: price * needL + pfee })).wait();
  };
  const tapeout = async (netlist, nIn, nOut) => {
    const rc = await (await proc.tapeout(netlist, nIn, nOut, { value: tapeFee })).wait();
    const ev = rc.logs.map((l) => { try { return proc.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TapedOut");
    return { id: ev.args.circuitId, tx: rc.hash };
  };

  const maj = buildMaj3();
  let majId = opts.majId != null ? BigInt(opts.majId) : null;
  if (majId === null) {
    await ensureTransistors(6, 0);
    const r = await tapeout(hex(maj.netlist), 3, 1);
    majId = r.id;
    log(`taped out MAJ3 as circuit #${majId} (tx ${r.tx})`);
  }
  if ((await proc.netlist(majId)) !== hex(maj.netlist)) throw new Error(`circuit #${majId} is not MAJ3`);

  const latch = buildLatch(PROCESSOR, majId);
  const majC = decode(maj.netlist, 3, 1, () => { throw new Error("no REF in MAJ3"); });
  const c = decode(latch.netlist, 6, 2, () => majC);
  const ownNand = c.els.filter((e) => e.op === "NAND").length;
  const ownLatch = c.els.filter((e) => e.op === "LATCH").length;
  let latchId = opts.latchId != null ? BigInt(opts.latchId) : null;
  if (latchId === null) {
    await ensureTransistors(ownNand, ownLatch); // REF'd gates are not burned again
    const r = await tapeout(hex(latch.netlist), 6, 2);
    latchId = r.id;
    log(`taped out the latch as circuit #${latchId}: ${ownNand} NAND + ${ownLatch} LATCH + REF #${majId} (tx ${r.tx})`);
  }
  if ((await proc.netlist(latchId)) !== hex(latch.netlist)) throw new Error(`circuit #${latchId} is not the Latchkey latch`);

  const opener = new ethers.Contract(OPENER, OPENER_ABI, signer);
  const container = await opener.accountOf(PROCESSOR, latchId);
  if (opts.open !== false && !(await opener.isOpened(PROCESSOR, latchId))) {
    const fee = await opener.FEE();
    await (await opener.open(PROCESSOR, latchId, { value: fee })).wait();
    log(`opened container ${container} (${ethers.formatEther(fee)} OKB)`);
  }
  log(`spent ${ethers.formatEther(bal0 - (await ethers.provider.getBalance(signer.address)))} OKB in total`);
  return {
    proc,
    majId,
    latchId,
    container,
    majNetlist: hex(maj.netlist),
    latchNetlist: hex(latch.netlist),
    latchGates: ownNand + ownLatch + majC.els.length,
  };
}

module.exports = { tapeOutLatchkey, PROCESSOR, OPENER, HUB, SITES, BINDING };
