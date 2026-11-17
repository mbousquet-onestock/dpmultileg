import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { apiRouter } from './routes.js';

export function createApp(webDist?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter());

  if (webDist && existsSync(webDist)) {
    // The page is designed to be embedded in the OneStock back office (iframe).
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', `frame-ancestors ${config.frameAncestors}`);
      next();
    });
    app.use(express.static(webDist, { index: 'index.html', maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(webDist, 'index.html')));
  }
  return app;
}
