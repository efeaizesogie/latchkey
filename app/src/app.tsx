import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Mark } from './ui';
import { net, isFork, dep } from './lib/config';
import { account, wallets, connect, disconnect, short, FORK_ACTORS, forkReady, useForkActor, walletName, explain } from './lib/chain';
import { Landing } from './pages/Landing';
import { Create } from './pages/Create';
import { VaultPage } from './pages/Vault';
import { Proof } from './pages/Proof';
import { Mine } from './pages/Mine';
import { Stats } from './pages/Stats';

export const route = signal(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => {
  route.value = location.hash.slice(1) || '/';
  window.scrollTo(0, 0);
});
export const go = (r: string) => (location.hash = r);

export const picker = signal(false);

function WalletButton() {
  const a = account.value;
  if (a)
    return (
      <button class="btn small quiet" onClick={() => go('/mine')} title={walletName.value}>
        <span class="mono">{short(a)}</span>
      </button>
    );
  return <button class="btn small" onClick={() => (picker.value = true)}>Connect</button>;
}

function Picker() {
  const [err, setErr] = useState<string | null>(null);
  if (!picker.value) return null;
  const close = () => { picker.value = false; setErr(null); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Connect a wallet" style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,10,14,.7)', display: 'grid', placeItems: 'end center' }} onClick={close}>
      <div class="card stack" style={{ width: 'min(480px, 100%)', borderRadius: '18px 18px 0 0', marginBottom: 0, '--gap': '12px' } as any} onClick={(e) => e.stopPropagation()}>
        <div class="spread"><h3>Connect</h3><button class="linkbtn" onClick={close}>Close</button></div>
        {isFork && (
          <div class="dev stack" style={{ '--gap': '8px' } as any}>
            <p class="meta">Local fork: pick a test person (keys are Hardhat’s public test keys, worthless).</p>
            {FORK_ACTORS.map((a, i) => (
              <button class="btn block quiet" onClick={() => { useForkActor(i); close(); }}>{a.name} <span class="mono meta">{short(a.account.address)}</span></button>
            ))}
          </div>
        )}
        {wallets.value.map((w) => (
          <button class="btn block quiet" onClick={async () => { try { await connect(w); close(); } catch (e) { setErr(explain(e)); } }}>
            {w.icon && <img src={w.icon} alt="" width={22} height={22} />} {w.name}
          </button>
        ))}
        {!wallets.value.length && !isFork && (
          <p class="muted">No wallet found in this browser. Open this page in the OKX Wallet app (Discover → paste the link), or install a browser wallet.</p>
        )}
        {err && <p class="err">{err}</p>}
        {account.value && <button class="linkbtn" onClick={() => { disconnect(); close(); }}>Disconnect {short(account.value)}</button>}
      </div>
    </div>
  );
}

export function App() {
  const r = route.value;
  useEffect(() => {
    if (isFork) forkReady.then(() => { try { const i = sessionStorage.getItem('lk.actor'); if (i) useForkActor(Number(i)); } catch {} });
  }, []);
  let page;
  if (r.startsWith('/v/')) page = <VaultPage address={r.slice(3).split(/[/?]/)[0] as `0x${string}`} />;
  else if (r === '/new') page = <Create />;
  else if (r === '/proof') page = <Proof />;
  else if (r === '/mine') page = <Mine />;
  else if (r === '/stats') page = <Stats />;
  else page = <Landing />;
  return (
    <>
      <header class="top">
        <div class="shell">
          <a class="brand" href="#/" aria-label="Latchkey home"><Mark /> Latchkey</a>
          <div class="row">
            <span class="netpill" title={net.name}>{isFork ? 'fork' : 'X Layer'}</span>
            <WalletButton />
          </div>
        </div>
      </header>
      <main>{page}</main>
      <footer class="foot">
        <div class="shell spread" style={{ flexWrap: 'wrap' }}>
          <span>Latchkey · self-custodial · no admin over funds · {dep ? <span class="mono">{dep.tapeName}</span> : 'X Layer'}</span>
          <span class="row wrap"><a href="#/proof">How the latch works</a><a href="#/stats">On-chain stats</a><a href="#/mine">My vaults</a></span>
        </div>
      </footer>
      <Picker />
    </>
  );
}
