import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, configProblems } from './config.js';
import { log } from './logger.js';
import { apiRouter } from './routes.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function createApp(webDist?: string) {
  const app = express();
  app.disable('x-powered-by');

  // Request id (reuses the Vercel one when present) + access log.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.header('x-vercel-id') ?? '').split('::').pop() || randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    const started = Date.now();
    const path = req.path; // captured now: mounted routers strip their prefix from req.path
    res.on('finish', () => {
      if (!path.startsWith('/api')) return;
      log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http', {
        request_id: id,
        method: req.method,
        path,
        status: res.statusCode,
        ms: Date.now() - started,
        site_id: req.session?.site_id,
        environment: req.session?.environment,
      });
    });
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Misconfigured deployment: answer an explicit JSON error instead of crashing.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const problems = configProblems();
    if (!problems.length || req.path === '/health') return next();
    res.status(503).json({ error: 'server_misconfigured', message: problems.join(' ; '), problems, request_id: req.requestId });
  });

  app.use('/api', apiRouter());
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: `${req.method} /api${req.path} does not exist`, request_id: req.requestId });
  });

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
