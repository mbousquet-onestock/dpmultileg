/**
 * Vercel serverless entry point: every /api/* request is rewritten here (see vercel.json)
 * and handled by the Express application. Static files (web/dist) are served by Vercel's CDN.
 *
 * The app is loaded dynamically so that a startup failure (module not found, bad configuration...)
 * is returned as a readable JSON error and logged, instead of Vercel's opaque FUNCTION_INVOCATION_FAILED page.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let app: Promise<Handler> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    app ??= import('../server/src/app.js').then((m) => m.createApp() as unknown as Handler);
    (await app)(req, res);
  } catch (e) {
    app = undefined;
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(JSON.stringify({ level: 'error', msg: 'startup_failed', error: err.message, stack: err.stack }));
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'startup_failed', message: err.message, stack: err.stack?.split('\n').slice(0, 8) }));
  }
}
