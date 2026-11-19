import { parseAbi } from 'viem';

export const factoryAbi = parseAbi([
  'function createVault(address heir, uint64 window) payable returns (address)',
  'function setupFee() view returns (uint256)',
  'function claimFeeBps() view returns (uint16)',
  'function circuitId() view returns (uint256)',
  'function processor() view returns (address)',
  'function treasury() view returns (address)',
  'function vaultCount() view returns (uint256)',
  'function vaultsOf(address owner) view returns (address[])',
  'function vaultsForHeir(address heir) view returns (address[])',
  'function isVault(address) view returns (bool)',
  'event VaultCreated(address indexed vault, address indexed owner, address indexed heir, uint64 window, uint256 deposit)',
]);

export const vaultAbi = parseAbi([
  'function snapshot() view returns (address owner_, address heir_, uint64 window_, uint64 lastCheckIn_, uint64 deadline_, uint8 latch_, uint64 trippedAt_, uint64 beats_, uint256 circuitId_, address processor_, uint256 okb)',
  'struct BeatRecord { uint64 blockNumber; uint64 time; uint8 stateBefore; uint8 expired; uint8 alive; uint8 stateAfter; }',
  'function history(uint256 from, uint256 n) view returns (BeatRecord[])',
  'function canTrip() view returns (bool)',
  'function claimFeeBps() view returns (uint16)',
  'function createdBlock() view returns (uint64)',
  'function checkIn()',
  'function trip()',
  'function claim(address[] tokens)',
  'function setHeir(address heir)',
  'function setWindow(uint64 window)',
  'function withdraw(address token, uint256 amount, address to)',
  'error NotOwner()',
  'error NotHeir()',
  'error IsTripped()',
  'error NotTripped()',
  'error NotYet(uint64 deadline)',
  'error BadWindow()',
  'error BadAddress()',
  'error CircuitFailed()',
  'error SetupFee(uint256 required)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

export const processorAbi = parseAbi([
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function netlist(uint256 id) view returns (bytes)',
  'function step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)',
  'function ownerOf(uint256 id) view returns (address)',
  'function name() view returns (string)',
]);
