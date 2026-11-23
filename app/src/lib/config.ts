import type { Address } from 'viem';

export type Deployment = {
  factory: Address;
  herald: Address;
  circuitId: string;
  majId: string;
  container: Address;
  tapeName: string;
  chainId?: number;
  token?: Address;
};

export type Net = {
  key: 'xlayer' | 'fork';
  chainId: number;
  name: string;
  /** Read nodes. On X Layer these are TapeKit's default nodes (two operators), so reads are allowed on the DeWEB gateway. */
  rpcs: string[];
  explorer: string; // '' when none
  processor: Address;
  processorName: string;
  hub: Address;
  opener: Address;
  dep: Deployment | null;
  tokens: Token[];
};

export type Token = { symbol: string; address: Address | null; decimals: number; note?: string };

export const OKB: Token = { symbol: 'OKB', address: null, decimals: 18 };
export const ZERO = '0x0000000000000000000000000000000000000000' as Address;

const XLAYER_TOKENS: Token[] = [
  { symbol: 'USDT0', address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', decimals: 6, note: 'USD₮0' },
  { symbol: 'USDT', address: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', decimals: 6 },
  { symbol: 'USDC', address: '0x74b7f16337b8972027f6196a17a631ac6de26d22', decimals: 6 },
  OKB,
];

const TAPEOUT = {
  processor: '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355' as Address, // OrderGuard
  processorName: 'OrderGuard',
  hub: '0xe61A9C7213a6Aa616C246a2B569e555B417b25ee' as Address, // TapeSend
  opener: '0x536adD8F30f03b69f6fbF29d425A816A0dC50106' as Address,
};

declare const __FORK_DEPLOYMENT__: Deployment | null;
declare const __XLAYER_DEPLOYMENT__: Deployment | null;
declare const __FORK_BUILD__: boolean;

export const NETS: Record<Net['key'], Net> = {
  xlayer: {
    key: 'xlayer',
    chainId: 196,
    name: 'X Layer',
    rpcs: ['https://rpc.xlayer.tech', 'https://xlayer.drpc.org'],
    explorer: 'https://www.oklink.com/x-layer',
    ...TAPEOUT,
    dep: typeof __XLAYER_DEPLOYMENT__ !== 'undefined' ? __XLAYER_DEPLOYMENT__ : null,
    tokens: XLAYER_TOKENS,
  },
  fork: {
    key: 'fork',
    chainId: (typeof __FORK_DEPLOYMENT__ !== 'undefined' && __FORK_DEPLOYMENT__?.chainId) || 196,
    name: 'X Layer fork (local)',
    rpcs: __FORK_BUILD__ ? ['http://127.0.0.1:' + '8545'] : [], // stripped from the on-chain build
    explorer: '',
    ...TAPEOUT,
    dep: typeof __FORK_DEPLOYMENT__ !== 'undefined' ? __FORK_DEPLOYMENT__ : null,
    tokens: XLAYER_TOKENS,
  },
};
if (NETS.fork.dep?.token) NETS.fork.tokens = [{ symbol: 'USDT0', address: NETS.fork.dep.token, decimals: 6, note: 'test token on the fork' }, OKB];

function pickNet(): Net {
  const q = new URLSearchParams(location.search);
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const want = q.get('net') ?? (local ? 'fork' : 'xlayer');
  return want === 'fork' && NETS.fork.dep ? NETS.fork : NETS.xlayer;
}

export const net = pickNet();
export const isFork = net.key === 'fork';
export const dep = net.dep;
export const circuitId = dep ? BigInt(dep.circuitId) : null;

export const WINDOWS: { label: string; seconds: number; hint: string }[] = [
  { label: '30 days', seconds: 30 * 86400, hint: 'For a backup wallet you control' },
  { label: '90 days', seconds: 90 * 86400, hint: 'Most people pick this' },
  { label: '180 days', seconds: 180 * 86400, hint: 'Long trips, low effort' },
  { label: '1 year', seconds: 365 * 86400, hint: 'Check in on your birthday' },
];
export const GRACES: { label: string; seconds: number; hint: string }[] = [
  { label: '3 days', seconds: 3 * 86400, hint: 'Quick' },
  { label: '7 days', seconds: 7 * 86400, hint: 'Most people pick this' },
  { label: '14 days', seconds: 14 * 86400, hint: 'Extra margin' },
  { label: '30 days', seconds: 30 * 86400, hint: 'Very cautious' },
];
export const DEMO_WINDOW = { label: '3 minutes', seconds: 180, hint: 'Demo only: watch it trip' };
export const DEMO_GRACE = { label: '1 minute', seconds: 60, hint: 'Demo only' };

export const explorerTx = (h: string) => (net.explorer ? `${net.explorer}/tx/${h}` : '');
export const explorerAddr = (a: string) => (net.explorer ? `${net.explorer}/address/${a}` : '');
