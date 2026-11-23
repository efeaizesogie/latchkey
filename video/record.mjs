// Record the app scenes on the local X Layer fork (real TapeOut processor + TapeSend hub), phone-sized, via the
// DevTools screencast. Each shot -> out/shots/<scene>-<n>/frames + list.txt (ffconcat with real frame durations).
//   node record.mjs            (dev server on APP, fork node on 127.0.0.1:8545)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP = process.env.APP ?? 'http://localhost:5174/';
const RPC = 'http://127.0.0.1:8545';
const ACTORS = { none: null, ada: 0, tobi: 1, stranger: 2, gus: 3, gia: 4 };
const ADDR = { tobi: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', gus: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', gia: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (method, params = []) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());

rmSync('out/shots', { recursive: true, force: true });
mkdirSync('out/shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--hide-scrollbars', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
await page.evaluateOnNewDocument(() => {
  const st = document.createElement('style');
  // hide the fork-only rehearsal box; no scrollbar flashes
  st.textContent = '.dev{display:none!important} ::-webkit-scrollbar{display:none}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
});
const cdp = await page.createCDPSession();

async function as(actor, hash) {
  await page.evaluate((i) => { i === null ? sessionStorage.removeItem('lk.actor') : sessionStorage.setItem('lk.actor', String(i)); localStorage.setItem('lk.net', 'fork'); }, ACTORS[actor]);
  await page.goto(`${APP}?net=fork#${hash}`, { waitUntil: 'networkidle2' });
  if (ACTORS[actor] !== null) {
    // select the fork test person through the app itself (dev server only)
    await page.evaluate(async (i) => { const ch = await import('/src/lib/chain.ts'); await ch.forkReady; ch.useForkActor(i); }, ACTORS[actor]);
    await page.waitForFunction(() => /0x[0-9a-fA-F]{2,}/.test(document.querySelector('.top')?.innerText ?? ''), { timeout: 10000 });
  }
  await sleep(1200);
}

async function shot(name, fn) {
  const dir = `out/shots/${name}`;
  mkdirSync(dir, { recursive: true });
  const frames = [];
  cdp.on('Page.screencastFrame', onFrame);
  function onFrame(f) {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  }
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  // a nudge so the first frame arrives immediately
  await page.evaluate(() => { document.body.style.outline = '0px solid transparent'; });
  const t0 = Date.now() / 1000;
  await fn();
  await sleep(300);
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  if (!frames.length) throw new Error(`no frames for ${name}`);
  let list = 'ffconcat version 1.0\n';
  frames.forEach((f, i) => {
    const file = `${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(f.t + 0.04, f.t + (t1 - t0) - (f.t - frames[0].t));
    list += `file '${file}'\nduration ${Math.max(0.01, next - f.t).toFixed(3)}\n`;
  });
  list += `file '${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  writeFileSync(`${dir}/list.txt`, list);
  console.log(`shot ${name}: ${frames.length} frames, ${(t1 - t0).toFixed(1)} s`);
}

// ------------------------------------------------------------------ page helpers
const scrollTo = (sel, ms = 1600, offset = 90) =>
  page.evaluate(async ({ sel, ms, offset }) => {
    const el = typeof sel === 'number' ? null : document.querySelector(sel) ?? [...document.querySelectorAll('h2,h3,b,div')].find((e) => e.textContent.trim().startsWith(sel));
    const target = typeof sel === 'number' ? sel : Math.max(0, (el?.getBoundingClientRect().top ?? 0) + scrollY - offset);
    const start = scrollY, t0 = performance.now();
    await new Promise((res) => {
      const step = (t) => {
        const p = Math.min(1, (t - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        scrollTo(0, start + (target - start) * e);
        p < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }, { sel, ms, offset });
const click = async (text, scope = 'main') => {
  const ok = await page.evaluate(({ text, scope }) => {
    const b = [...document.querySelectorAll(`${scope} button, ${scope} a`)].find((x) => x.innerText.trim().startsWith(text));
    if (!b) return false;
    b.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }, { text, scope });
  if (!ok) {
    await page.screenshot({ path: 'out/debug.png' });
    console.log('PAGE TEXT:', (await page.evaluate(() => document.querySelector('main')?.innerText ?? '')).slice(0, 900));
    throw new Error(`no button "${text}"`);
  }
  await sleep(500);
  await page.evaluate(({ text, scope }) => [...document.querySelectorAll(`${scope} button, ${scope} a`)].find((x) => x.innerText.trim().startsWith(text)).click(), { text, scope });
};
const type = async (index, text, perChar = 28, scope = 'main input') => {
  for (let i = 1; i <= text.length; i++) {
    await page.evaluate(({ index, v, scope }) => {
      const el = [...document.querySelectorAll(scope)][index];
      el.scrollIntoView({ block: 'center' });
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { index, v: text.slice(0, i), scope });
    await sleep(perChar);
  }
};
const waitText = (t, ms = 15000) => page.waitForFunction((t) => document.querySelector('main')?.innerText.includes(t), { timeout: ms }, t);

// ------------------------------------------------------------------ scenes
let vault = '';
await page.goto(`${APP}?net=fork#/`, { waitUntil: 'networkidle2' });

await as('none', '/');
await shot('s02-landing-1', async () => {
  await sleep(2600);
  await scrollTo('.strip', 2600, 120);
  await sleep(900);
  await scrollTo('.film', 2400, 70);
  await sleep(3600);
});

await as('ada', '/new');
await shot('s03-create-1', async () => {
  await sleep(700);
  await type(0, ADDR.tobi, 14);
  await type(1, '15.2.272.tape', 45);
  await sleep(1300);
  await click('Continue');
  await sleep(900);
  await click('3 minutes'); await sleep(450);
  await click('1 minute'); await sleep(700);
  await click('Continue');
  await sleep(800);
  await type(0, ADDR.gus, 10); await type(1, ADDR.gia, 10);
  await sleep(600);
  await click('Continue');
  await sleep(900);
  await type(1, '0.5', 120);
  await sleep(600);
  await click('Create vault');
  await page.waitForFunction(() => location.hash.includes('/v/'), { timeout: 30000 });
  vault = await page.evaluate(() => location.hash.split('/v/')[1].split('?')[0]);
  await sleep(2200);
  await page.evaluate(() => document.querySelector('#fund')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(900);
  await type(0, '1250', 110, '#fund input.input');
  await sleep(500);
  await click('Deposit 1250');
  await waitText('1,250');
  await sleep(1800);
});
console.log('vault', vault);

await shot('s04-checkin-1', async () => {
  await scrollTo(0, 1400);
  await sleep(800);
  await click('Check in', 'main .card');
  await sleep(2600);
  await scrollTo('Every beat', 1800, 120);
  await sleep(2600);
});

await as('none', '/proof');
await shot('s05-proof-1', async () => {
  await sleep(1500);
  await scrollTo('svg.gates', 2600, 260);
  await sleep(3200);
  await scrollTo('What it does', 2400, 80);
  await page.waitForFunction(() => document.querySelector('main').innerText.includes('256/256'), { timeout: 30000 });
  await sleep(4200);
  await scrollTo('On X Layer', 2600, 80);
  await sleep(3000);
});

// silence: move the fork's clock past the window
await rpc('evm_increaseTime', [181]); await rpc('evm_mine');
await as('stranger', `/v/${vault}`);
await shot('s06-quiet-1', async () => {
  await sleep(1600);
  await click('Start the grace period');
  await waitText('grace period left');
  await sleep(2600);
});
await as('gus', `/v/${vault}`);
await shot('s06-quiet-2', async () => {
  await sleep(1200);
  await click('I confirm');
  await waitText('You confirmed');
  await sleep(1800);
});
await as('gia', `/v/${vault}`);
await shot('s06-quiet-3', async () => {
  await sleep(1100);
  await click('I confirm');
  await waitText('Trip the latch');
  await sleep(1400);
  await click('Trip the latch');
  await waitText('has tripped');
  await sleep(3200);
});

await as('tobi', `/v/${vault}`);
await shot('s07-claim-1', async () => {
  await sleep(1800);
  await click('Claim to my wallet');
  await waitText('Claimed.');
  await sleep(1800);
  await scrollTo('TapeSend notices', 2000, 140);
  await sleep(2600);
});

await as('none', '/');
await shot('s08-outlive-1', async () => {
  await page.evaluate(() => { const el = [...document.querySelectorAll('h2')].find((h) => h.textContent.startsWith('Built to outlive')); scrollTo(0, el.getBoundingClientRect().top + scrollY - 400); });
  await sleep(400);
  await scrollTo('Built to outlive', 2200, 90);
  await sleep(4200);
  await scrollTo('.stats', 2200, 220);
  await sleep(4200);
  await scrollTo('.cta-photo', 2200, 120);
  await sleep(2600);
});

await as('none', '/stats');
await shot('s09-business-1', async () => {
  await sleep(4200);
  await scrollTo('USDT0 protected', 2400, 220);
  await sleep(3000);
  await scrollTo('Latest TapeSend', 2600, 90);
  await sleep(4500);
});

writeFileSync('out/vault.txt', vault);
await browser.close();
console.log('done');
