import { resolve } from 'node:path';
import { createApp } from './app.js';
import { config } from './config.js';
import { getStore } from './db.js';

const store = await getStore();
console.log(`[dpmultileg] credentials storage: ${store.kind}`);
const app = createApp(process.env.WEB_DIST ?? resolve(process.cwd(), 'web/dist'));
app.listen(config.port, () => {
  console.log(`[dpmultileg] API listening on http://localhost:${config.port}`);
  if (config.mockOnestock) console.log('[dpmultileg] MOCK_ONESTOCK=true: fake OneStock data is served');
  if (config.allowUnsigned) console.log('[dpmultileg] ALLOW_UNSIGNED=true: unsigned sessions are accepted for sites without extension secrets');
});
