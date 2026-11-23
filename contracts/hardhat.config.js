require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-network-helpers");

// Load contracts/.env (DEPLOYER_KEY, TREASURY, ...) without extra dependencies. Never commit .env.
try {
  for (const line of require("node:fs").readFileSync(__dirname + "/.env", "utf8").split(String.fromCharCode(10))) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const FORK = process.env.FORK === "1";
const XLAYER_RPC = process.env.XLAYER_RPC || "https://rpc.xlayer.tech";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 500 }, evmVersion: "paris" },
  },
  networks: {
    hardhat: {
      chainId: FORK ? 196 : 31337,
      ...(FORK ? { forking: { url: XLAYER_RPC, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) } } : {}),
      hardfork: "cancun",
      chains: { 196: { hardforkHistory: { berlin: 0, london: 0, merge: 0, shanghai: 0, cancun: 0 } } },
    },
    localhost: { url: "http://127.0.0.1:8545", timeout: 600000 },
    xlayer: {
      url: XLAYER_RPC,
      chainId: 196,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
  mocha: { timeout: 600000 },
};
