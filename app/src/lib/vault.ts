import type { Address, Hex } from 'viem';
import { formatUnits, keccak256, concat, hexToBytes } from 'viem';
import { pub, readAgreed, type Agreement } from './chain';
import { vaultAbi, erc20Abi, factoryAbi, processorAbi, heraldAbi, hubAbi, openerAbi, cpuFactoryAbi } from './abi';
import { net, dep, circuitId, hasHerald, type Token, ZERO } from './config';

export type BeatRecord = { blockNumber: bigint; time: bigint; stateBefore: number; inputs: number; stateAfter: number };
export type Phase = 'open' | 'grace' | 'tripped';

export type VaultView = {
  address: Address;
  owner: Address;
  heir: Address;
  window: number;
  grace: number;
  lastCheckIn: number;
  warnedAt: number;
  trippedAt: number;
  state: number; // bit 0 warn, bit 1 tripped
  phase: Phase;
  confirmations: number;
  guardians: Address[]; // non-empty seats
  seats: Address[]; // all three seats, ZERO when empty
  ownerInbox: Address | null;
  heirInbox: Address | null;
  beats: number;
  deadline: number; // when a grace period can start
  graceEndsAt: number; // when the latch can trip (0 if no grace period)
  claimFeeBps: number;
  balances: { token: Token; raw: bigint; text: string }[];
  history: BeatRecord[];
  agreement: Agreement;
};

export async function loadVault(address: Address): Promise<VaultView> {
  const { value: snap, agreement } = await readAgreed((c, blockNumber) =>
    c.readContract({ address, abi: vaultAbi, functionName: 'snapshot', blockNumber })
  );
  const [owner, heir, window, grace, lastCheckIn, warnedAt, trippedAt, state, confirmations, beats, okb] = snap as unknown as any[];
  const nBeats = Number(beats);
  const from = nBeats > 50 ? nBeats - 50 : 0;
  const erc = net.tokens.filter((t) => t.address);
  const [history, seats, ownerInbox, heirInbox, fee, ...balances] = await Promise.all([
    pub.readContract({ address, abi: vaultAbi, functionName: 'history', args: [BigInt(from), 50n] }),
    pub.readContract({ address, abi: vaultAbi, functionName: 'guardians' }),
    pub.readContract({ address, abi: vaultAbi, functionName: 'ownerInbox' }),
    pub.readContract({ address, abi: vaultAbi, functionName: 'heirInbox' }),
    pub.readContract({ address, abi: vaultAbi, functionName: 'claimFeeBps' }),
    ...erc.map((t) => pub.readContract({ address: t.address!, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch(() => 0n)),
  ]);
  let i = 0;
  const bals = net.tokens.map((t) => {
    const raw = t.address ? (balances[i++] as bigint) : (okb as bigint);
    return { token: t, raw, text: fmt(raw, t.decimals) };
  });
  const st = Number(state);
  const w = Number(window), g = Number(grace), lc = Number(lastCheckIn), wa = Number(warnedAt);
  const seatList = [...(seats as readonly Address[])];
  return {
    address,
    owner,
    heir,
    window: w,
    grace: g,
    lastCheckIn: lc,
    warnedAt: wa,
    trippedAt: Number(trippedAt),
    state: st,
    phase: st & 2 ? 'tripped' : st & 1 ? 'grace' : 'open',
    confirmations: Number(confirmations),
    seats: seatList,
    guardians: seatList.filter((a) => a !== ZERO),
    ownerInbox: ownerInbox === ZERO ? null : (ownerInbox as Address),
    heirInbox: heirInbox === ZERO ? null : (heirInbox as Address),
    beats: nBeats,
    deadline: lc + w,
    graceEndsAt: st & 1 ? wa + g : 0,
    claimFeeBps: Number(fee),
    balances: bals,
    history: (history as any[]).map((h) => ({ ...h, stateBefore: Number(h.stateBefore), inputs: Number(h.inputs), stateAfter: Number(h.stateAfter) })).reverse(),
    agreement,
  };
}

export async function myVaults(who: Address) {
  if (!dep) return { owned: [] as Address[], heirOf: [] as Address[], guardianOf: [] as Address[] };
  const [owned, heirOf, guardianOf] = await Promise.all(
    (['vaultsOf', 'vaultsForHeir', 'vaultsForGuardian'] as const).map((fn) =>
      pub.readContract({ address: dep!.factory, abi: factoryAbi, functionName: fn, args: [who] })
    )
  );
  const rev = (x: readonly Address[]) => [...x].reverse() as Address[];
  return { owned: rev(owned), heirOf: rev(heirOf), guardianOf: rev(guardianOf) };
}

export async function factoryInfo() {
  if (!dep) return null;
  const [setupFee, claimFeeBps, count] = await Promise.all([
    pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: 'setupFee' }),
    pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: 'claimFeeBps' }),
    pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: 'vaultCount' }),
  ]);
  return { setupFee, claimFeeBps: Number(claimFeeBps), count: Number(count) };
}

export async function circuitInfo(id: bigint) {
  const [info, netlist, owner] = await Promise.all([
    pub.readContract({ address: net.processor, abi: processorAbi, functionName: 'circuitInfo', args: [id] }),
    pub.readContract({ address: net.processor, abi: processorAbi, functionName: 'netlist', args: [id] }),
    pub.readContract({ address: net.processor, abi: processorAbi, functionName: 'ownerOf', args: [id] }).catch(() => null),
  ]);
  return { nIn: info[0], nOut: info[1], nState: info[2], gates: info[3], netlist: netlist as Hex, owner };
}

/** Ask the real processor for one beat of the latch (read-only). state and inputs are packed bytes. */
export async function stepOnChain(id: bigint, state: number, inputs: number) {
  const [ns, out] = await pub.readContract({
    address: net.processor,
    abi: processorAbi,
    functionName: 'step',
    args: [id, `0x${state.toString(16).padStart(2, '0')}`, `0x${inputs.toString(16).padStart(2, '0')}`],
  });
  return { next: parseInt(ns as string, 16) & 3, out: parseInt(out as string, 16) & 3 };
}

// ------------------------------------------------------------------ TapeSend (the herald's messages)

export type Notice = { to: Hex; inboxIndex: number; blockNumber: bigint; time: number; subject: string; body: string; verified: boolean };

/** TAP-10 endpoint ID of a container on this chain. */
export const endpointOf = (container: Address): Hex =>
  `0x${((BigInt(net.chainId) << 160n) | BigInt(container)).toString(16).padStart(64, '0')}` as Hex;

/**
 * The newest messages Latchkey's container sent over TapeSend: the hub's outbox gives (to, index, block, digest);
 * the payload comes from the Sent event in that one block and is checked against the digest (TAP-10 §13).
 */
export async function heraldNotices(limit = 12): Promise<{ total: number; notices: Notice[] }> {
  if (!dep || !hasHerald) return { total: 0, notices: [] };
  const total = Number(await pub.readContract({ address: net.hub, abi: hubAbi, functionName: 'outboxCount', args: [dep.container] }));
  if (!total) return { total, notices: [] };
  const start = Math.max(0, total - limit);
  const page = await pub.readContract({ address: net.hub, abi: hubAbi, functionName: 'outboxPage', args: [dep.container, BigInt(start), BigInt(limit)] });
  const notices = await Promise.all(
    [...page].reverse().map(async (e): Promise<Notice> => {
      const base = { to: e.to as Hex, inboxIndex: Number(e.inboxIndex), blockNumber: BigInt(e.blockNumber), time: Number(e.timestamp), subject: '', body: '', verified: false };
      try {
        const logs = await pub.getContractEvents({ address: net.hub, abi: hubAbi, eventName: 'Sent', args: { to: e.to as Hex, from: dep!.container }, fromBlock: base.blockNumber, toBlock: base.blockNumber });
        const log = logs.find((l) => Number(l.args.inboxIndex) === base.inboxIndex);
        if (!log) return base;
        const payload = log.args.payload as Hex;
        const verified = keccak256(concat([log.args.ref as Hex, keccak256(payload)])) === e.digest;
        const bytes = hexToBytes(payload);
        if (bytes[0] !== 0x54 || bytes[1] !== 0x53 || bytes[3] !== 0x00) return { ...base, verified };
        const content = JSON.parse(new TextDecoder().decode(bytes.slice(4)));
        return { ...base, verified, subject: String(content.subject ?? ''), body: String(content.body ?? '') };
      } catch {
        return base;
      }
    })
  );
  return { total, notices };
}

/** Resolve "<id>.2.<cpu>.tape", "#<id>@<cpu>" or a container address to a container address (TAP-10 §4). */
export async function resolveInbox(input: string): Promise<Address | null> {
  const s = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s as Address;
  const m = s.match(/^(\d+)\.2\.(\d+)\.tape$/) ?? s.match(/^#?(\d+)@(\d+)(?:\.xlayer)?$/);
  if (!m) return null;
  const [id, cpu] = [BigInt(m[1]), BigInt(m[2])];
  const processor = await pub.readContract({ address: '0x1f09DAeFA827f02CBb40967cc91b259763760761', abi: cpuFactoryAbi, functionName: 'cpuAt', args: [cpu] });
  return (await pub.readContract({ address: net.opener, abi: openerAbi, functionName: 'accountOf', args: [processor, id] })) as Address;
}

// ------------------------------------------------------------------ stats (on-chain data)

export async function stats() {
  if (!dep) return null;
  const count = Number(await pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: 'vaultCount' }));
  const addrs = (await pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: 'vaultsPage', args: [0n, 200n] })) as Address[];
  const rows = await Promise.all(addrs.map((a) => pub.readContract({ address: a, abi: vaultAbi, functionName: 'snapshot' }).then((s) => s as unknown as any[]).catch(() => null)));
  const usdt0 = net.tokens.find((t) => t.symbol === 'USDT0')?.address;
  const usd = usdt0 ? await Promise.all(addrs.map((a) => pub.readContract({ address: usdt0, abi: erc20Abi, functionName: 'balanceOf', args: [a] }).catch(() => 0n))) : [];
  let open = 0, grace = 0, tripped = 0, beats = 0, okb = 0n;
  for (const s of rows) {
    if (!s) continue;
    const st = Number(s[7]);
    if (st & 2) tripped++;
    else if (st & 1) grace++;
    else open++;
    beats += Number(s[9]);
    okb += s[10] as bigint;
  }
  const sent = !hasHerald ? 0 : Number(await pub.readContract({ address: dep.herald, abi: heraldAbi, functionName: 'sent' }).catch(() => 0n));
  return { count, open, grace, tripped, beats, okb, usdt0: usd.reduce((x, y) => x + (y as bigint), 0n), sent, sampled: addrs.length };
}

// ------------------------------------------------------------------ formatting

export function fmt(raw: bigint, decimals: number, max = 4) {
  const s = formatUnits(raw, decimals);
  const [i, f = ''] = s.split('.');
  const ff = f.slice(0, max).replace(/0+$/, '');
  return Number(i).toLocaleString('en-US') + (ff ? '.' + ff : '');
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
  if (sec < 3600) return `${Math.round(sec / 60)} minute${Math.round(sec / 60) === 1 ? '' : 's'}`;
  return duration(sec);
}

export const circuitReady = circuitId !== null;
