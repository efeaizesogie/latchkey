import { useEffect, useState } from 'preact/hooks';
import type { Address } from 'viem';
import { account, short, disconnect, walletName } from '../lib/chain';
import { myVaults, loadVault, type VaultView, duration, windowLabel } from '../lib/vault';
import { Bit, useNow } from '../ui';
import { picker } from '../app';

function Row({ addr }: { addr: Address }) {
  const [v, setV] = useState<VaultView | null>(null);
  const now = useNow(5000);
  useEffect(() => { loadVault(addr).then(setV).catch(() => {}); }, [addr]);
  return (
    <li>
      <a href={`#/v/${addr}`} class="spread" style={{ textDecoration: 'none' }}>
        <div>
          <div class="mono">{short(addr)}</div>
          <div class="meta">
            {!v ? 'reading…' : v.latch ? 'Tripped' : v.deadline > now ? `${duration(v.deadline - now)} left of ${windowLabel(v.window)}` : 'Window passed'}
          </div>
        </div>
        {v && <Bit on={v.latch === 1} />}
      </a>
    </li>
  );
}

export function Mine() {
  const a = account.value;
  const [list, setList] = useState<{ owned: Address[]; heirOf: Address[] } | null>(null);
  useEffect(() => { if (a) myVaults(a).then(setList).catch(() => setList({ owned: [], heirOf: [] })); }, [a]);
  if (!a)
    return (
      <section class="shell section"><div class="narrow stack">
        <h2>Your vaults</h2><p class="muted">Connect the wallet you created a vault with, or the one a vault opens for.</p>
        <div><button class="btn primary" onClick={() => (picker.value = true)}>Connect</button></div>
      </div></section>
    );
  return (
    <section class="shell section">
      <div class="narrow stack" style={{ '--gap': '22px' } as any}>
        <div class="spread"><h2>Your vaults</h2><a class="btn small" href="#/new">New vault</a></div>
        <p class="meta">{walletName.value} · <span class="mono">{short(a)}</span> · <button class="linkbtn" onClick={disconnect}>Disconnect</button></p>
        <div class="card">
          <h3>You own</h3>
          {!list ? <p class="meta">reading…</p> : list.owned.length ? <ul class="list">{list.owned.map((x) => <Row addr={x} />)}</ul> : <p class="muted" style={{ marginTop: '10px' }}>None yet. <a href="#/new">Set a latch</a>.</p>}
        </div>
        <div class="card">
          <h3>Open for you</h3>
          {!list ? <p class="meta">reading…</p> : list.heirOf.length ? <ul class="list">{list.heirOf.map((x) => <Row addr={x} />)}</ul> : <p class="muted" style={{ marginTop: '10px' }}>No vault names this address as receiver.</p>}
        </div>
      </div>
    </section>
  );
}
