import type { Address } from 'viem';
import { formatUnits } from 'viem';
import { pub } from './chain';
import { vaultAbi, erc20Abi, factoryAbi, processorAbi } from './abi';
import { net, type Token } from './config';

export type BeatRecord = { blockNumber: bigint; time: bigint; stateBefore: number; expired: number; alive: number; stateAfter: number };

export type VaultView = {
  address: Address;
  owner: Address;
  heir: Address;
  window: number;
  lastCheckIn: number;
  deadline: number;
  latch: 0 | 1;
  trippedAt: number;
  beats: number;
  circuitId: bigint;
  processor: Address;
  claimFeeBps: number;
  balances: { token: Token; raw: bigint; text: string }[];
  history: BeatRecord[];
};

export async function loadVault(address: Address): Promise<VaultView> {
  const [snap, fee] = await Promise.all([
    pub.readContract({ address, abi: vaultAbi, functionName: 'snapshot' }),
    pub.readContract({ address, abi: vaultAbi, functionName: 'claimFeeBps' }),
  ]);
  const [owner, heir, window, lastCheckIn, deadline, latch, trippedAt, beats, circuitId, processor, okb] = snap as unknown as any[];
  const nBeats = Number(beats);
  const from = nBeats > 50 ? nBeats - 50 : 0;
  const [history, ...erc] = await Promise.all([
    pub.readContract({ address, abi: vaultAbi, functionName: 'history', args: [BigInt(from), 50n] }),
    ...net.tokens.filter((t) => t.address).map((t) => pub.readContract({ address: t.address!, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch(() => 0n)),
  ]);
  let i = 0;
  const balances = net.tokens.map((t) => {
    const raw = t.address ? (erc[i++] as bigint) : (okb as bigint);
    return { token: t, raw, text: fmt(raw, t.decimals) };
  });
  return {
    address,
    owner,
    heir,
    window: Number(window),
    lastCheckIn: Number(lastCheckIn),
    deadline: Number(deadline),
    latch: Number(latch) as 0 | 1,
    trippedAt: Number(trippedAt),
    beats: nBeats,
    circuitId,
    processor,
    claimFeeBps: Number(fee),
    balances,
    history: (history as any[]).map((h) => ({ ...h, stateBefore: Number(h.stateBefore), expired: Number(h.expired), alive: Number(h.alive), stateAfter: Number(h.stateAfter) })).reverse(),
  };
}

export async function myVaults(who: Address) {
  if (!net.factory) return { owned: [] as Address[], heirOf: [] as Address[] };
  const [owned, heirOf] = await Promise.all([
    pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultsOf', args: [who] }),
    pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultsForHeir', args: [who] }),
  ]);
  return { owned: [...owned].reverse() as Address[], heirOf: [...heirOf].reverse() as Address[] };
}

export async function factoryInfo() {
  if (!net.factory) return null;
  const [setupFee, claimFeeBps, count] = await Promise.all([
    pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'setupFee' }),
    pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'claimFeeBps' }),
    pub.readContract({ address: net.factory, abi: factoryAbi, functionName: 'vaultCount' }),
  ]);
  return { setupFee, claimFeeBps: Number(claimFeeBps), count: Number(count) };
}

export async function circuitInfo(id: bigint) {
  const [info, netlist, owner] = await Promise.all([
    pub.readContract({ address: net.processor, abi: processorAbi, functionName: 'circuitInfo', args: [id] }),
    pub.readContract({ address: net.processor, abi: processorAbi, functionName: 'netlist', args: [id] }),
    pub.readContract({ address: net.processor, abi: processorAbi, functionName: 'ownerOf', args: [id] }).catch(() => null),
  ]);
  return { nIn: info[0], nOut: info[1], nState: info[2], gates: info[3], netlist: netlist as `0x${string}`, owner };
}

/** Ask the real processor for one beat (read-only). */
export async function stepOnChain(id: bigint, q: number, expired: number, alive: number) {
  const [ns, out] = await pub.readContract({
    address: net.processor,
    abi: processorAbi,
    functionName: 'step',
    args: [id, `0x0${q}` as `0x${string}`, `0x0${expired | (alive << 1)}` as `0x${string}`],
  });
  return { next: parseInt(ns as string, 16) & 1, out: parseInt(out as string, 16) & 1 };
}

export function fmt(raw: bigint, decimals: number, max = 4) {
  const s = formatUnits(raw, decimals);
  const [i, f = ''] = s.split('.');
  const ff = f.slice(0, max).replace(/0+$/, '');
  return (Number(i).toLocaleString('en-US') + (ff ? '.' + ff : ''));
}

export function duration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 2) return `${d} days`;
  if (d === 1) return `1 day ${h} h`;
  if (h >= 1) return `${h} h ${m} min`;
  if (m >= 1) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

export function windowLabel(sec: number) {
  if (sec % 86400 === 0) return sec / 86400 === 365 ? '1 year' : `${sec / 86400} days`;
  if (sec < 3600) return `${Math.round(sec / 60)} minutes`;
  return duration(sec);
}
