// Publish app/dist/index.html to X Layer DeWEB, stored in the latch circuit's own container (TAP-10).
//
//   1. open the circuit's ERC-6551 container (one-time TapeOut fee, read from the Opener)
//   2. putFile + appendChunk (24,000-byte chunks) into SiteRegistry; resumable
//   3. setFallback("index.html"), bind "<circuit>.2.<cpu index>.tape" (fee read from DomainBinding)
//   4. read every byte back and compare SHA-256
//
//   npx hardhat run scripts/publish-deweb.js --network localhost   (rehearsal on a fork)
//   DEPLOYER_KEY=0x... npx hardhat run scripts/publish-deweb.js --network xlayer
// The signer must own the circuit NFT. Env: FILE (default ../app/dist/index.html), MONTHS (default 120).
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROCESSOR = "0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355";
const FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761";
const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";
const SITES = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6";
const BINDING = "0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9";
const CHUNK = 24_000;
const PATH = "index.html";

const openerAbi = [
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function isOpened(address circuits, uint256 tokenId) view returns (bool)",
  "function open(address circuits, uint256 tokenId) payable returns (address)",
  "function FEE() view returns (uint256)",
];
const sitesAbi = [
  "function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)",
  "function readRange(address container, string path, uint256 offset, uint256 len) view returns (bytes)",
  "function fallbackPath(address container) view returns (string)",
  "function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)",
  "function appendChunk(address container, string path, uint256 expectIndex, bytes data)",
  "function setFallback(address container, string path)",
];
const bindingAbi = [
  "function monthlyFee() view returns (uint256)",
  "function isLive(string name, address container) view returns (bool)",
  "function isContainerLive(address container) view returns (bool)",
  "function bind(string name, address container, uint256 months) payable",
];

async function main() {
  const live = network.name === "xlayer";
  if (network.name === "localhost") await network.provider.send("hardhat_mine", ["0x1"]);
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", live ? "xlayer.json" : "fork.json"), "utf8"));
  const circuitId = BigInt(dep.circuitId);
  const [me] = await ethers.getSigners();
  const proc = new ethers.Contract(PROCESSOR, ["function ownerOf(uint256) view returns (address)"], me);
  if ((await proc.ownerOf(circuitId)).toLowerCase() !== me.address.toLowerCase()) throw new Error(`signer ${me.address} does not own circuit #${circuitId}`);

  // the on-chain name: <circuit id>.<area code 2 = X Layer>.<processor index in the factory>
  const fac = new ethers.Contract(FACTORY, ["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"], me);
  let cpuIndex = process.env.CPU_INDEX ? Number(process.env.CPU_INDEX) : 272;
  if ((await fac.cpuAt(cpuIndex)).toLowerCase() !== PROCESSOR.toLowerCase()) {
    const n = Number(await fac.cpuCount());
    for (cpuIndex = 0; cpuIndex < n; cpuIndex++) if ((await fac.cpuAt(cpuIndex)).toLowerCase() === PROCESSOR.toLowerCase()) break;
  }
  const NAME = `${circuitId}.2.${cpuIndex}.tape`;

  const opener = new ethers.Contract(OPENER, openerAbi, me);
  const sites = new ethers.Contract(SITES, sitesAbi, me);
  const binding = new ethers.Contract(BINDING, bindingAbi, me);
  const [container, opened, fee, monthly] = await Promise.all([
    opener.accountOf(PROCESSOR, circuitId),
    opener.isOpened(PROCESSOR, circuitId),
    opener.FEE(),
    binding.monthlyFee(),
  ]);
  const file = fs.readFileSync(process.env.FILE || path.join(__dirname, "..", "..", "app", "dist", "index.html"));
  if (/127\.0\.0\.1:8545/.test(file.toString()) && live) throw new Error("this build still contains the fork config: rebuild with LK_ONCHAIN=1");
  const sha = "0x" + crypto.createHash("sha256").update(file).digest("hex");
  const chunks = [];
  for (let i = 0; i < file.length; i += CHUNK) chunks.push(file.subarray(i, i + CHUNK));
  const months = BigInt(process.env.MONTHS || 120);
  console.log(`${NAME}: container ${container}, opened ${opened}, open fee ${ethers.formatEther(fee)} OKB, monthly ${ethers.formatEther(monthly)} OKB`);
  console.log(`file ${file.length} bytes, ${chunks.length} chunks, sha256 ${sha}`);
  const bal0 = await ethers.provider.getBalance(me.address);

  const tx = async (label, p) => {
    const t = await p;
    const r = await t.wait();
    console.log(`  ${label}: ${r.hash} (gas ${r.gasUsed})`);
  };
  if (!opened) await tx("open container", opener.open(PROCESSOR, circuitId, { value: fee }));

  const have = await sites.fileInfo(container, PATH).catch(() => null);
  let start = 1;
  if (have && have.sha256Hash === sha && Number(have.chunkCount) <= chunks.length) start = Number(have.chunkCount);
  else await tx(`putFile 1/${chunks.length}`, sites.putFile(container, PATH, "text/html; charset=utf-8", sha, chunks[0]));
  for (let i = start; i < chunks.length; i++) await tx(`appendChunk ${i + 1}/${chunks.length}`, sites.appendChunk(container, PATH, i, chunks[i]));
  if ((await sites.fallbackPath(container)) !== PATH) await tx("setFallback", sites.setFallback(container, PATH));
  if (!(await binding.isLive(NAME, container))) await tx(`bind ${NAME}`, binding.bind(NAME, container, months, { value: monthly * months }));

  const info = await sites.fileInfo(container, PATH);
  let back = Buffer.alloc(0);
  for (let off = 0; off < Number(info.size); off += 60_000)
    back = Buffer.concat([back, Buffer.from((await sites.readRange(container, PATH, off, 60_000)).slice(2), "hex")]);
  const backSha = "0x" + crypto.createHash("sha256").update(back).digest("hex");
  const ok = backSha === sha && back.length === file.length;
  console.log(`read back ${back.length} bytes, sha256 ${ok ? "matches" : "MISMATCH " + backSha}`);
  console.log(`spent ${ethers.formatEther(bal0 - (await ethers.provider.getBalance(me.address)))} OKB`);
  console.log(`live: ${await binding.isContainerLive(container)}  →  https://${NAME.replace(/\.tape$/, "").replace(/\./g, "-")}.tapekit.org/  ·  tape://${NAME}/`);
  if (!ok) process.exit(1);

  const depPath = path.join(__dirname, "..", "deployments", live ? "xlayer.json" : "fork.json");
  fs.writeFileSync(depPath, JSON.stringify({ ...dep, tapeName: NAME, container, siteSha256: sha }, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
