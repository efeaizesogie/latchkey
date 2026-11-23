import { signal } from '@preact/signals';
import type { Address } from 'viem';
import { loadVault, type VaultView } from './vault';

/**
 * Getting-started progress. Most steps are read from the chain (vault exists, funded, checked in). The two that
 * only happen off chain (told the receiver, set a reminder) are remembered in this browser; if storage is blocked
 * the checklist still works, those steps just show as not done yet.
 */
export type StepKey = 'connect' | 'create' | 'fund' | 'share' | 'remind' | 'checkin';
type LocalKey = 'share' | 'remind';

const KEY = 'lk.onboarding.v1';
function read(): Record<string, true> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
/** bumps whenever a local step is marked, so components re-render */
export const progressTick = signal(0);

export function markDone(vault: Address, key: LocalKey) {
  const all = read();
  const id = `${vault.toLowerCase()}:${key}`;
  if (all[id]) return;
  all[id] = true;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  progressTick.value++;
}

export function isDone(vault: Address, key: LocalKey) {
  void progressTick.value; // subscribe
  return !!read()[`${vault.toLowerCase()}:${key}`];
}

export type Step = { key: StepKey; title: string; body: string; done: boolean };

/** The owner's path, with live state when a vault is known. */
export function ownerSteps(connected: boolean, v: VaultView | null): Step[] {
  const funded = !!v && v.balances.some((b) => b.raw > 0n);
  const checkedIn = !!v && v.history.some((h) => (h.inputs >> 1) & 1);
  return [
    { key: 'connect', title: 'Connect your wallet', body: 'OKX Wallet or MetaMask. Latchkey never sees your keys; your wallet approves every step.', done: connected },
    { key: 'create', title: 'Create your vault', body: 'Name who it opens for, how long a silence means something is wrong, a grace period, and optional guardians.', done: !!v },
    { key: 'fund', title: 'Put something in it', body: 'Deposit USDT0, USDT, USDC or OKB from your wallet, or withdraw from OKX straight to the vault address on X Layer.', done: funded },
    { key: 'share', title: 'Tell your receiver', body: 'Send them the vault link, or print the card for your papers. They only need it once the latch trips.', done: !!v && isDone(v.address, 'share') },
    { key: 'remind', title: 'Set a check-in reminder', body: 'Add reminders to your calendar so a busy month never looks like silence.', done: !!v && isDone(v.address, 'remind') },
    { key: 'checkin', title: 'Do your first check-in', body: 'One tap restarts your window. Do it now so you know how it feels.', done: checkedIn },
  ];
}

export const RECEIVER_STEPS = [
  { title: 'Keep the link somewhere safe', body: 'The owner sends you the vault link (or a printed card). Nothing to do until the latch trips. You can open it any time to watch.' },
  { title: 'Watch for a TapeSend message', body: 'If you gave the owner a TapeSend inbox, Latchkey messages it when the vault opens for you. Otherwise the vault page shows it.' },
  { title: 'Connect the named wallet', body: 'Open the vault link and connect the exact wallet the owner named as receiver. Any other wallet can only watch.' },
  { title: 'Claim', body: 'Once the latch has tripped, tap “Claim to my wallet”. Everything inside moves to you, minus a 0.2% fee. Anything sent later can be claimed too.' },
];

export const GUARDIAN_STEPS = [
  { title: 'You were named by the owner', body: 'Guardians are up to three people the owner trusts. You never touch the funds and cannot act while the owner is checking in.' },
  { title: 'Wait for a grace period', body: 'Only after the owner has been silent for their whole window can anyone start a grace period. The vault page shows it.' },
  { title: 'Confirm only if you are sure', body: 'If you know the owner is gone, connect your wallet on the vault page and tap “I confirm the owner is gone”. Two of three confirmations end the grace period early.' },
  { title: 'The owner can always cancel', body: 'One check-in from the owner clears every confirmation and closes the grace period. Nothing is lost if you confirmed by mistake.' },
];

/** The owner's newest vault that is still open (the one setup steps are about), or null. */
export async function latestOpenVault(owned: Address[]): Promise<VaultView | null> {
  for (const a of owned.slice(0, 5)) {
    const v = await loadVault(a).catch(() => null);
    if (v && v.phase !== 'tripped') return v;
  }
  return null;
}
