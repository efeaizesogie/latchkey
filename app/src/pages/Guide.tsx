import { useEffect, useState } from 'preact/hooks';
import type { Address } from 'viem';
import { account, short } from '../lib/chain';
import { myVaults, type VaultView } from '../lib/vault';
import { ownerSteps, RECEIVER_STEPS, GUARDIAN_STEPS, progressTick, latestOpenVault } from '../lib/onboarding';
import { Checklist } from '../Checklist';
import { go, picker } from '../app';

type Role = 'owner' | 'receiver' | 'guardian';

/** Owner actions shared by the guide and My vaults: each takes you to where the step happens. */
export function ownerActions(v: VaultView | null) {
  const at = (step: string) => () => v && go(`/v/${v.address}?step=${step}`);
  return {
    connect: { label: 'Connect wallet', run: () => (picker.value = true) },
    create: { label: 'Create my vault', run: () => go('/new') },
    fund: { label: 'Add funds', run: at('fund') },
    share: { label: 'Share the link', run: at('share') },
    remind: { label: 'Add reminders', run: at('share') },
    checkin: { label: 'Check in now', run: at('checkin') },
  };
}

function VaultLinks({ list, empty }: { list: Address[] | null; empty: string }) {
  if (!account.value) return null;
  if (!list) return <p class="meta">Looking for vaults that name this wallet…</p>;
  if (!list.length) return <p class="meta">{empty}</p>;
  return (
    <div class="card stack" style={{ '--gap': '8px' } as any}>
      <p class="meta">Vaults that name {short(account.value)}:</p>
      {list.map((a) => <a class="btn small quiet" href={`#/v/${a}`} style={{ justifyContent: 'space-between' }}><span class="mono">{short(a)}</span><span aria-hidden="true">→</span></a>)}
    </div>
  );
}

export function Guide() {
  const initial = (new URLSearchParams(location.hash.split('?')[1] ?? '').get('role') as Role) || 'owner';
  const [role, setRole] = useState<Role>(initial);
  const [mine, setMine] = useState<{ owned: Address[]; heirOf: Address[]; guardianOf: Address[] } | null>(null);
  const [latest, setLatest] = useState<VaultView | null>(null);
  const a = account.value;
  void progressTick.value;

  useEffect(() => {
    setMine(null);
    setLatest(null);
    if (!a) return;
    myVaults(a).then(async (m) => {
      setMine(m);
      setLatest(await latestOpenVault(m.owned));
    }).catch(() => setMine({ owned: [], heirOf: [], guardianOf: [] }));
  }, [a]);

  const steps = ownerSteps(!!a, latest);
  const allDone = steps.every((s) => s.done);

  return (
    <section class="shell section" style={{ paddingTop: '36px' }}>
      <div class="narrow stack" style={{ '--gap': '22px' } as any}>
        <h2>How to use Latchkey</h2>
        <p class="muted">Pick what brings you here. Each path is a few short steps, and nothing needs us in the middle.</p>

        <div class="role-tabs" role="tablist" aria-label="Your role">
          {([['owner', 'Protect my crypto'], ['receiver', 'I was named receiver'], ['guardian', 'I’m a guardian']] as const).map(([k, label]) => (
            <button role="tab" aria-selected={role === k} onClick={() => setRole(k)}>{label}</button>
          ))}
        </div>

        {role === 'owner' && (
          <div class="stack" style={{ '--gap': '18px' } as any}>
            {allDone && latest ? (
              <div class="card stack" style={{ '--gap': '10px' } as any}>
                <h3>You’re all set.</h3>
                <p class="muted">Your vault is funded, your receiver knows, and reminders are on. From here, just check in when your calendar says so.</p>
                <div><a class="btn small primary" href={`#/v/${latest.address}`}>Open my vault →</a></div>
              </div>
            ) : (
              <Checklist steps={steps} title={latest ? 'Your vault, step by step' : 'Set up in about a minute'} actions={ownerActions(latest)} />
            )}
            <ol class="guide-steps" aria-label="What each step means">
              {steps.map((s) => <li><div><b>{s.title}</b><p>{s.body}</p></div></li>)}
            </ol>
            <div class="card line stack" style={{ '--gap': '10px' } as any}>
              <h3>Good to know</h3>
              <p class="muted">While the latch is open, only you can move funds, and you can withdraw everything at any time. A check-in during a grace period cancels it. Once the latch trips it can never be undone, so pick a window you can keep.</p>
            </div>
          </div>
        )}

        {role === 'receiver' && (
          <div class="stack" style={{ '--gap': '18px' } as any}>
            <ol class="guide-steps">{RECEIVER_STEPS.map((s) => <li><div><b>{s.title}</b><p>{s.body}</p></div></li>)}</ol>
            {a ? <VaultLinks list={mine?.heirOf ?? null} empty="No vault named this wallet as receiver when it was created. If the owner changed it later, open the link they sent you." />
              : <div><button class="btn primary" onClick={() => (picker.value = true)}>Connect the named wallet</button></div>}
          </div>
        )}

        {role === 'guardian' && (
          <div class="stack" style={{ '--gap': '18px' } as any}>
            <ol class="guide-steps">{GUARDIAN_STEPS.map((s) => <li><div><b>{s.title}</b><p>{s.body}</p></div></li>)}</ol>
            {a ? <VaultLinks list={mine?.guardianOf ?? null} empty="No vault lists this wallet as a guardian yet." />
              : <div><button class="btn primary" onClick={() => (picker.value = true)}>Connect my wallet</button></div>}
          </div>
        )}
      </div>
    </section>
  );
}
