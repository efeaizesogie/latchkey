// 1280x720 YouTube thumbnail from the same frame template (title mode + the brass bit).
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 / 3 });
const q = new URLSearchParams({ mode: 'title', head: 'Lose your phone, [lose your crypto?]', sub: 'A vault that opens for your heir or backup wallet. On X Layer.', bit: '1' });
await p.goto(`${pathToFileURL(path.resolve('frame.html')).href}?${q}`, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
await p.addStyleTag({ content: '.title h1{font-size:128px;max-width:1500px} .title p{font-size:44px;max-width:1600px} .bit{width:150px;height:150px;font-size:90px}' });
await new Promise((r) => setTimeout(r, 200));
await p.screenshot({ path: 'out/thumbnail.png', type: 'png' });
await b.close();
