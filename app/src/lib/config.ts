import type { Address } from 'viem';

export type Net = {
  key: 'xlayer' | 'fork';
  chainId: number;
  name: string;
  rpc: string;
  explorer: string; // tx/address base, '' when none
  factory: Address | null;
  processor: Address;
  processorName: string;
  circuitId: bigint | null;
  /** The .tape name of the DeWEB site that serves this app. */
  tapeName: string | null;
  tokens: Token[];
};

export type Token = { symbol: string; address: Address | null; decimals: number; note?: string };

export const OKB: Token = { symbol: 'OKB', address: null, decimals: 18 };

const XLAYER_TOKENS: Token[] = [
  { symbol: 'USDT0', address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', decimals: 6, note: 'USD₮0' },
  { symbol: 'USDT', address: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', decimals: 6 },
  { symbol: 'USDC', address: '0x74b7f16337b8972027f6196a17a631ac6de26d22', decimals: 6 },
  OKB,
];

// Filled in by contracts/scripts/deploy.js output (deployments/*.json) at release time.
export const NETS: Record<Net['key'], Net> = {
  xlayer: {
    key: 'xlayer',
    chainId: 196,
    name: 'X Layer',
    rpc: 'https://rpc.xlayer.tech',
    explorer: 'https://www.oklink.com/x-layer',
    factory: null,
    processor: '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355',
    processorName: 'OrderGuard',
    circuitId: null,
    tapeName: null,
    tokens: XLAYER_TOKENS,
  },
  fork: {
    key: 'fork',
    chainId: 31337,
    name: 'X Layer fork (local)',
    rpc: 'http://127.0.0.1:8545',
    explorer: '',
    factory: null,
    processor: '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355',
    processorName: 'OrderGuard',
    circuitId: null,
    tapeName: null,
    tokens: XLAYER_TOKENS,
  },
};

declare const __FORK_DEPLOYMENT__: { factory: Address; circuitId: string; token?: Address } | null;
declare const __XLAYER_DEPLOYMENT__: { factory: Address; circuitId: string; tapeName?: string } | null;

if (typeof __XLAYER_DEPLOYMENT__ !== 'undefined' && __XLAYER_DEPLOYMENT__) {
  NETS.xlayer.factory = __XLAYER_DEPLOYMENT__.factory;
  NETS.xlayer.circuitId = BigInt(__XLAYER_DEPLOYMENT__.circuitId);
  NETS.xlayer.tapeName = __XLAYER_DEPLOYMENT__.tapeName ?? null;
}
if (typeof __FORK_DEPLOYMENT__ !== 'undefined' && __FORK_DEPLOYMENT__) {
  NETS.fork.factory = __FORK_DEPLOYMENT__.factory;
  NETS.fork.circuitId = BigInt(__FORK_DEPLOYMENT__.circuitId);
  if (__FORK_DEPLOYMENT__.token)
    NETS.fork.tokens = [{ symbol: 'USDT0', address: __FORK_DEPLOYMENT__.token, decimals: 6, note: 'test token on the fork' }, OKB];
}

function pickNet(): Net {
  const q = new URLSearchParams(location.search);
  const want = q.get('net') ?? (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'fork' : 'xlayer');
  return want === 'fork' && NETS.fork.factory ? NETS.fork : NETS.xlayer;
}

export const net = pickNet();
export const isFork = net.key === 'fork';

export const WINDOWS: { label: string; seconds: number; hint: string }[] = [
  { label: '30 days', seconds: 30 * 86400, hint: 'For a backup wallet you control' },
  { label: '90 days', seconds: 90 * 86400, hint: 'Most people pick this' },
  { label: '180 days', seconds: 180 * 86400, hint: 'Long trips, low effort' },
  { label: '1 year', seconds: 365 * 86400, hint: 'Check in on your birthday' },
];
export const DEMO_WINDOW = { label: '3 minutes', seconds: 180, hint: 'Demo only: watch it trip' };

export const explorerTx = (h: string) => (net.explorer ? `${net.explorer}/tx/${h}` : '');
export const explorerAddr = (a: string) => (net.explorer ? `${net.explorer}/address/${a}` : '');
