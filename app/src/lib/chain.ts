import { signal, computed } from '@preact/signals';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  defineChain,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hash,
  type WalletClient,
  type EIP1193Provider,
} from 'viem';
import { net, isFork } from './config';

export const chain = defineChain({
  id: net.chainId,
  name: net.name,
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: net.rpcs } },
  blockExplorers: net.explorer ? { default: { name: 'OKLink', url: net.explorer } } : undefined,
});

export const pub = createPublicClient({ chain, transport: http(net.rpcs[0], { retryCount: 2, timeout: 20_000 }) });
/** One client per independent node operator (TAP-10 §5: adopt a read only when independent nodes agree). */
export const pubs = net.rpcs.map((u) => createPublicClient({ chain, transport: http(u, { retryCount: 1, timeout: 15_000 }) }));

export type Agreement = { nodes: number; agreed: boolean | null };
const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
/**
 * Read the same contract call from every node at the same block and compare. agreed = true when all answers match,
 * false when any differ (the caller should not trust the value), null when only one node was reachable.
 */
export async function readAgreed<T>(call: (c: typeof pub, blockNumber?: bigint) => Promise<T>): Promise<{ value: T; agreement: Agreement }> {
  if (pubs.length < 2) return { value: await call(pub), agreement: { nodes: 1, agreed: null } };
  const block = (await pub.getBlockNumber()) - 2n; // a block every node has
  const settled = await Promise.allSettled(pubs.map((c) => call(c, block)));
  const ok = settled.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  const agreed = ok.length < 2 ? null : ok.every((v) => canon(v) === canon(ok[0]));
  return { value: ok[0] as T, agreement: { nodes: ok.length, agreed } };
}

// ---------------------------------------------------------------- wallets

type Discovered = { id: string; name: string; icon: string; provider: EIP1193Provider };
export const wallets = signal<Discovered[]>([]);
export const account = signal<Address | null>(null);
export const walletName = signal<string>('');
let walletClient: WalletClient | null = null;
let activeProvider: EIP1193Provider | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e: any) => {
    const d = e.detail;
    if (!d?.info || !d?.provider) return;
    if (wallets.value.some((w) => w.id === d.info.uuid)) return;
    wallets.value = [...wallets.value, { id: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider }];
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    const eth = (window as any).okxwallet ?? (window as any).ethereum;
    if (eth && wallets.value.length === 0) wallets.value = [{ id: 'injected', name: (window as any).okxwallet ? 'OKX Wallet' : 'Browser wallet', icon: '', provider: eth }];
  }, 400);
}

/** Test-only keys of the local Hardhat fork (public, well known, worthless). Never used on X Layer. */
/** Hardhat's public test mnemonic: worthless keys used only on the local fork, never on X Layer.
 *  Loaded only in fork builds (__FORK_BUILD__), so the on-chain build carries no key code at all. */
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
type Actor = { name: string; account: any };
export const FORK_ACTORS: Actor[] = [];
export const forkReady: Promise<void> =
  __FORK_BUILD__ && isFork
    ? import('viem/accounts').then(({ mnemonicToAccount }) => {
        ['Ada (owner)', 'Tobi (heir)', 'Stranger', 'Gus (guardian)', 'Gia (guardian)'].forEach((name, i) => FORK_ACTORS.push({ name, account: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: i }) }));
      })
    : Promise.resolve();
declare const __FORK_BUILD__: boolean;

export function useForkActor(i: number) {
  const a = FORK_ACTORS[i];
  walletClient = createWalletClient({ chain, transport: http(net.rpcs[0]), account: a.account });
  activeProvider = null;
  account.value = a.account.address;
  walletName.value = a.name;
  try { sessionStorage.setItem('lk.actor', String(i)); } catch {}
}

export async function connect(w: Discovered) {
  const accs = (await w.provider.request({ method: 'eth_requestAccounts' })) as Address[];
  activeProvider = w.provider;
  walletClient = createWalletClient({ chain, transport: custom(w.provider), account: accs[0] });
  account.value = accs[0];
  walletName.value = w.name;
  (w.provider as any).on?.('accountsChanged', (a: Address[]) => {
    account.value = a[0] ?? null;
    if (a[0]) walletClient = createWalletClient({ chain, transport: custom(w.provider), account: a[0] });
  });
  try { localStorage.setItem('lk.wallet', w.name); } catch {}
}

export function disconnect() {
  walletClient = null;
  activeProvider = null;
  account.value = null;
  walletName.value = '';
  try { localStorage.removeItem('lk.wallet'); sessionStorage.removeItem('lk.actor'); } catch {}
}

export const connected = computed(() => account.value !== null);

async function ensureChain() {
  if (!activeProvider) return;
  const hex = ('0x' + net.chainId.toString(16)) as `0x${string}`;
  const cur = (await activeProvider.request({ method: 'eth_chainId' })) as string;
  if (parseInt(cur, 16) === net.chainId) return;
  try {
    await activeProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
    await activeProvider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hex, chainName: net.name, nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: net.rpcs, blockExplorerUrls: net.explorer ? [net.explorer] : [] }],
    });
  }
}

export type TxStage = 'idle' | 'preparing' | 'signing' | 'pending' | 'done' | 'error';

/** Simulate, sign, wait. Returns the receipt. Every write in the app goes through here. */
export async function send(req: { address: Address; abi: any; functionName: string; args?: any[]; value?: bigint }, onStage?: (s: TxStage, hash?: Hash) => void) {
  if (!walletClient || !account.value) throw new Error('Connect a wallet first.');
  onStage?.('preparing');
  await ensureChain();
  const { request } = await pub.simulateContract({ ...req, account: account.value } as any);
  onStage?.('signing');
  const hash = await walletClient.writeContract({ ...(request as any), account: walletClient.account ?? account.value, chain });
  onStage?.('pending', hash);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error('The transaction was included but reverted.');
  onStage?.('done', hash);
  return receipt;
}

export async function sendValue(to: Address, value: bigint, onStage?: (s: TxStage, hash?: Hash) => void) {
  if (!walletClient || !account.value) throw new Error('Connect a wallet first.');
  await ensureChain();
  onStage?.('signing');
  const hash = await walletClient.sendTransaction({ to, value, account: walletClient.account ?? account.value, chain });
  onStage?.('pending', hash);
  await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  onStage?.('done', hash);
  return hash;
}

const PLAIN: Record<string, string> = {
  NotOwner: 'Only the vault owner can do that.',
  NotHeir: 'Only the address named as receiver can claim.',
  IsTripped: 'The latch has already tripped. It cannot be reopened.',
  NotTripped: 'The latch is still open, so nothing can be claimed yet.',
  NothingToDo: 'Nothing to do yet: the circuit keeps the latch where it is until the next deadline.',
  NoGracePeriod: 'Guardians can only confirm while a grace period is running.',
  NotGuardian: 'This wallet is not one of the vault’s guardians.',
  CircuitWorks: 'The circuit is answering normally, so the safety valve is not needed.',
  BadWindow: 'Pick a window between 1 minute and 10 years, and a grace period between 1 minute and 1 year.',
  BadAddress: 'That address can’t be used here (empty, repeated, or already the owner or receiver).',
  CircuitFailed: 'The TapeOut circuit did not answer as expected. Nothing changed.',
  SetupFee: 'The setup fee was not included.',
};

/** Turn any wallet / RPC / revert error into one plain sentence. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name && PLAIN[name]) return PLAIN[name];
    const msg = e.shortMessage || e.message;
    if (/insufficient funds|enough funds/i.test(`${msg} ${(e as any).details ?? ''}`)) return 'Not enough OKB in this wallet to pay for gas.';
    if (/rejected|denied|User rejected/i.test(msg)) return 'You declined the request in your wallet. Nothing was sent.';
    if (/insufficient funds/i.test(msg)) return 'Not enough OKB in this wallet to pay for gas.';
    return msg;
  }
  const m = (e as any)?.message ?? String(e);
  if (/rejected|denied/i.test(m)) return 'You declined the request in your wallet. Nothing was sent.';
  return m;
}

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Fork only: move the local chain's clock forward (demo rehearsal). */
export async function forkSkip(seconds: number) {
  if (!isFork) return;
  await pub.request({ method: 'evm_increaseTime' as any, params: [seconds] as any });
  await pub.request({ method: 'evm_mine' as any, params: [] as any });
}

export async function chainNow(): Promise<number> {
  const b = await pub.getBlock({ blockTag: 'latest' });
  return Number(b.timestamp);
}
