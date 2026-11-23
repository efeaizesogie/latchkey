import { parseAbi } from 'viem';

export const factoryAbi = parseAbi([
  'function createVault(address heir, uint64 window, uint64 grace, address[3] guardians, address ownerInbox, address heirInbox) payable returns (address)',
  'function setupFee() view returns (uint256)',
  'function claimFeeBps() view returns (uint16)',
  'function circuitId() view returns (uint256)',
  'function herald() view returns (address)',
  'function treasury() view returns (address)',
  'function vaultCount() view returns (uint256)',
  'function vaultsPage(uint256 from, uint256 n) view returns (address[])',
  'function vaultsOf(address owner) view returns (address[])',
  'function vaultsForHeir(address heir) view returns (address[])',
  'function vaultsForGuardian(address guardian) view returns (address[])',
  'function isVault(address) view returns (bool)',
  'event VaultCreated(address indexed vault, address indexed owner, address indexed heir, uint64 window, uint64 grace, uint256 deposit)',
  'error SetupFee(uint256 required)',
]);

export const vaultAbi = parseAbi([
  'function snapshot() view returns (address owner_, address heir_, uint64 window_, uint64 grace_, uint64 lastCheckIn_, uint64 warnedAt_, uint64 trippedAt_, uint8 state_, uint8 confirmations_, uint64 beats_, uint256 okb)',
  'struct BeatRecord { uint64 blockNumber; uint64 time; uint8 stateBefore; uint8 inputs; uint8 stateAfter; }',
  'function history(uint256 from, uint256 n) view returns (BeatRecord[])',
  'function guardians() view returns (address[3])',
  'function ownerInbox() view returns (address)',
  'function heirInbox() view returns (address)',
  'function preview() view returns (uint8 next, bool changes)',
  'function claimFeeBps() view returns (uint16)',
  'function circuitId() view returns (uint256)',
  'function checkIn()',
  'function poke()',
  'function confirm()',
  'function claim(address[] tokens)',
  'function setHeir(address heir, address heirInbox)',
  'function setTimes(uint64 window, uint64 grace)',
  'function setGuardians(address[3] guardians)',
  'function setOwnerInbox(address inbox)',
  'function withdraw(address token, uint256 amount, address to)',
  'function tripWithoutCircuit()',
  'error NotOwner()',
  'error NotHeir()',
  'error NotGuardian()',
  'error IsTripped()',
  'error NotTripped()',
  'error NothingToDo(uint64 nextChangeAt)',
  'error NoGracePeriod()',
  'error BadWindow()',
  'error BadAddress()',
  'error CircuitFailed()',
  'error CircuitWorks()',
]);

export const heraldAbi = parseAbi([
  'function sent() view returns (uint256)',
  'function container() view returns (address)',
  'function tapeName() view returns (string)',
  'function ready() view returns (bool)',
]);

export const hubAbi = parseAbi([
  'struct OutEntry { bytes32 to; uint32 inboxIndex; uint56 blockNumber; uint40 timestamp; bytes32 digest; }',
  'function outboxPage(address from, uint256 start, uint256 n) view returns (OutEntry[])',
  'function outboxCount(address from) view returns (uint256)',
  'function inboxCount(bytes32 to) view returns (uint256)',
  'event Sent(bytes32 indexed to, address indexed from, bytes32 indexed ref, uint256 inboxIndex, uint256 outboxIndex, bytes payload)',
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
]);

export const openerAbi = parseAbi([
  'function accountOf(address circuits, uint256 tokenId) view returns (address)',
  'function isOpened(address circuits, uint256 tokenId) view returns (bool)',
]);

export const cpuFactoryAbi = parseAbi(['function cpuAt(uint256 i) view returns (address)']);
