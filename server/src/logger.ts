/**
 * Structured one-line JSON logs (readable in Vercel > Logs, or any log collector).
 * Never log passwords, tokens or signatures.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < min || process.env.VITEST) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function errorFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { error: e.message, error_name: e.name, stack: e.stack?.split('\n').slice(0, 6).join(' | ') };
  return { error: String(e) };
}
