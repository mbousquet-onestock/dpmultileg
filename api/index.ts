/**
 * Vercel serverless entry point: every /api/* request is rewritten here (see vercel.json)
 * and handled by the Express application. Static files (web/dist) are served by Vercel's CDN.
 */
import { createApp } from '../server/src/app.js';

export default createApp();
