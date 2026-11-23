// Make a fresh TESTNET-ONLY deployer wallet and save its key to contracts/.env.testnet (git-ignored).
// Prints only the address: fund it with free test OKB from https://web3.okx.com/xlayer/faucet.
//   node scripts/testnet-wallet.js
const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");

const file = path.join(__dirname, "..", ".env.testnet");
if (fs.existsSync(file)) {
  const key = (fs.readFileSync(file, "utf8").match(/TESTNET_DEPLOYER_KEY=(0x[0-9a-fA-F]{64})/) || [])[1];
  if (key) {
    console.log(`already set up. Testnet deployer: ${new Wallet(key).address}`);
    process.exit(0);
  }
}
const w = Wallet.createRandom();
fs.writeFileSync(file, `# X Layer TESTNET only. Never send real funds to this wallet.\nTESTNET_DEPLOYER_KEY=${w.privateKey}\n`);
console.log(`Testnet deployer: ${w.address}`);
console.log("Key saved to contracts/.env.testnet (git-ignored). Fund the address above from the X Layer testnet faucet.");
