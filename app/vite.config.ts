import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { existsSync, readFileSync } from 'node:fs';

const dep = (f: string) => {
  const p = new URL(`../contracts/deployments/${f}`, import.meta.url);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

// One self-contained index.html (fonts and code inlined) so the same file can be stored on X Layer DeWEB.
export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  define: {
    __FORK_BUILD__: JSON.stringify(process.env.LK_ONCHAIN !== '1'),
    __XLAYER_DEPLOYMENT__: JSON.stringify(dep('xlayer.json')),
    __FORK_DEPLOYMENT__: JSON.stringify(process.env.LK_ONCHAIN === '1' ? null : dep('fork.json')),
  },
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false, target: 'es2020' },
  server: { port: 5173 },
});
