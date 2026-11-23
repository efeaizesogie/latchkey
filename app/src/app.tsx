import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Mark } from './ui';
import { net, isRehearsal as isFork, dep } from './lib/config';
import { account, short, forkReady, useForkActor, walletName } from './lib/chain';
import { ConnectModal, picker } from './Connect';
import { NetSwitch, NetBanner } from './NetBar';
import { Landing } from './pages/Landing';
import { Create } from './pages/Create';
import { VaultPage } from './pages/Vault';
import { Proof } from './pages/Proof';
import { Mine } from './pages/Mine';
import { Stats } from './pages/Stats';
import { Guide } from './pages/Guide';

export const route = signal(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => {
  route.value = location.hash.slice(1) || '/';
  window.scrollTo(0, 0);
});
export const go = (r: string) => (location.hash = r);

export { picker };

function WalletButton() {
  const a = account.value;
  return (
    <button class={`btn small ${a ? 'quiet' : ''}`} onClick={() => (picker.value = true)} aria-haspopup="dialog" title={a ? walletName.value : undefined}>
      {a ? <span class="mono">{short(a)}</span> : 'Connect'}
    </button>
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
  else if (r.startsWith('/start')) page = <Guide />;
  else page = <Landing />;
  return (
    <>
      <header class="top">
        <div class="shell">
          <a class="brand" href="#/" aria-label="Latchkey home"><Mark /> Latchkey</a>
          <div class="row">
            <a class="navlink" href="#/start">How to use</a>
            <NetSwitch />
            <WalletButton />
          </div>
        </div>
      </header>
      <NetBanner />
      <main>{page}</main>
      <footer class="foot">
        <div class="shell spread" style={{ flexWrap: 'wrap' }}>
          <span>Latchkey · self-custodial · no admin over funds · {dep?.tapeName ? <span class="mono">{dep.tapeName}</span> : net.name}</span>
          <span class="row wrap"><a href="#/start">How to use</a><a href="#/proof">How the latch works</a><a href="#/stats">On-chain stats</a><a href="#/mine">My vaults</a></span>
        </div>
      </footer>
      <ConnectModal />
    </>
  );
}
