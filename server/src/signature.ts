import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureInput {
  extension_signature?: string;
  extension_id?: string;
  user_id?: string;
}

/**
 * Verify a OneStock UI extension signature.
 * Format: "t=<unix seconds>,h0=<hmac latest key>,h1=<hmac previous key>,h2=<hmac oldest key>"
 * Each h = HMAC-SHA256(`${t}.${extension_id}##${user_id}`) hex.
 * See "UI Extensibility - How to develop UI Extensions", chap. 3.
 */
export function verifyExtensionSignature(
  input: SignatureInput,
  secrets: string[],
  maxAgeSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const { extension_signature, extension_id, user_id } = input;
  if (!extension_signature || !extension_id || !user_id || secrets.length === 0) return false;

  const parts = new Map<string, string>();
  for (const part of extension_signature.split(',')) {
    const idx = part.indexOf('=');
    if (idx > 0) parts.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  const t = Number(parts.get('t'));
  if (!Number.isFinite(t) || t <= 0) return false;
  if (Math.abs(now - t) > maxAgeSeconds) return false;

  const hashes = [...parts.entries()].filter(([k]) => /^h\d+$/.test(k)).map(([, v]) => v);
  if (hashes.length === 0) return false;

  const message = `${t}.${extension_id}##${user_id}`;
  for (const secret of secrets) {
    const expected = Buffer.from(createHmac('sha256', secret).update(message).digest('hex'), 'utf8');
    for (const h of hashes) {
      const got = Buffer.from(h, 'utf8');
      if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
    }
  }
  return false;
}
