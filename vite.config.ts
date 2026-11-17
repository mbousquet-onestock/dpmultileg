import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const DS = '@onestock-public/design-system';

/** Use the official OneStock design system when installed, otherwise the local fallback (web/src/ds). */
function hasDesignSystem(): boolean {
  if (process.env.DS_FALLBACK === 'true') return false;
  try {
    require.resolve(`${DS}/package.json`);
    return true;
  } catch {
    return false;
  }
}

const useOfficialDs = hasDesignSystem();
const shim = (p: string) => fileURLToPath(new URL(`./web/src/ds/${p}`, import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@shared', replacement: fileURLToPath(new URL('./shared', import.meta.url)) },
      ...(useOfficialDs
        ? []
        : [
            { find: new RegExp(`^${DS}/dist/onestock-design-system\\.css$`), replacement: shim('empty.css') },
            { find: new RegExp(`^${DS}$`), replacement: shim('index.ts') },
          ]),
    ],
  },
  define: {
    __OFFICIAL_DS__: JSON.stringify(useOfficialDs),
    /** Deployed version, shown in the footer and in the error diagnostic. */
    __APP_VERSION__: JSON.stringify(
      `${(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? 'local').slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    ),
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    root: '.',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'web/**/*.test.ts'],
    environment: 'node',
  },
} as never);
