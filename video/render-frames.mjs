// Render the static layers of each scene: bg (photo, headline, phone shadow) and one shared bezel (transparent).
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const scenes = JSON.parse(readFileSync('scenes.json', 'utf8'));
const NOTE = 'Recorded on a local fork of X Layer mainnet: the real TapeOut processor and TapeSend hub.';
const FORKED = new Set(['s03-create', 's04-checkin', 's05-proof', 's06-quiet', 's07-claim']);
mkdirSync('out/frames', { recursive: true });
const b = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--hide-scrollbars'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const base = pathToFileURL(path.resolve('frame.html')).href;
const shot = async (qs, file, transparent = false) => {
  await p.goto(`${base}?${new URLSearchParams(qs)}`, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 150));
  await p.screenshot({ path: file, omitBackground: transparent });
};
await shot({ mode: 'bezel' }, 'out/frames/bezel.png', true);
let i = 0;
for (const s of scenes) {
  i++;
  const n = `${String(i).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
  if (s.kind === 'title') await shot({ mode: 'title', head: s.head, sub: s.sub, bit: s.id === 's10-end' ? '1' : '' }, `out/frames/${s.id}.png`);
  else await shot({ mode: 'bg', head: s.head, sub: s.sub, n, note: FORKED.has(s.id) ? NOTE : '' }, `out/frames/${s.id}.png`);
  console.log('frame', s.id);
}
await b.close();
