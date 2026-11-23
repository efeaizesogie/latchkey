// Checks app/dist/index.html against TapeKit's "100% on-chain" static rule (TapeKit SPEC §8):
// no off-chain URL in src/href/... attributes, srcset, CSS url() or @import, or meta refresh.
// (Same rule set as TapeKit's kernel; reimplemented here so the build can fail fast.)
//   node scripts/check-onchain.mjs [file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('../dist/index.html', import.meta.url);
const text = readFileSync(file, 'utf8');
const RULES = [
  ['attribute', /\b(?:src|href|action|poster|data|formaction|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi],
  ['srcset', /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi],
  ['css url()', /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi],
  ['@import', /@import\s+(?:"([^"]*)"|'([^']*)')/gi],
  ['meta refresh', /<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*content\s*=\s*["'][^"']*url=([^"'>\s]+)/gi],
];
const external = (u) => /^(?:https?|wss?|ftp):/i.test(u.trim()) || u.trim().startsWith('//');
const hits = [];
for (const [where, re] of RULES) {
  let m;
  while ((m = re.exec(text))) {
    const v = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const vals = where === 'srcset' ? v.split(',').map((s) => s.trim().split(/\s+/)[0]) : [v];
    for (const x of vals) if (x && external(x)) hits.push({ where, url: x, at: m.index });
  }
}
if (hits.length) {
  console.error(`NOT on-chain pure: ${hits.length} off-chain reference(s)`);
  for (const h of hits.slice(0, 20)) console.error(`  ${h.where} @${h.at}: ${h.url}  …${text.slice(Math.max(0, h.at - 40), h.at + 60).replace(/\s+/g, ' ')}`);
  process.exit(1);
}
console.log(`on-chain pure: ${text.length} bytes, 0 off-chain references (TapeKit SPEC §8 static rule)`);
