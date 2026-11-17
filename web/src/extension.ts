/**
 * OneStock UI extension contract (see "UI Extensibility - How to develop UI Extensions"):
 *  1. URL parameters: extension_id, user_id, site_id, lang, timezone, locale, parent_url, injection_point_path, host_app
 *  2. handshake: extension -> OneStock `extension_ready`, OneStock -> extension `onestock_data`
 *  3. the signature received in onestock_data is verified by our backend which issues a short-lived JWT
 */
export interface ExtensionParams {
  extension_id?: string;
  user_id?: string;
  site_id?: string;
  lang?: string;
  timezone?: string;
  locale?: string;
  parent_url?: string;
  injection_point_path?: string;
  host_app?: string;
}

export interface OnestockData {
  api_url?: string;
  extension_signature?: string;
  host_app?: string;
  injection_point_path?: string;
  user_id?: string;
  site_id?: string;
  endpoint_id?: string;
  [key: string]: unknown;
}

const KEYS: (keyof ExtensionParams)[] = ['extension_id', 'user_id', 'site_id', 'lang', 'timezone', 'locale', 'parent_url', 'injection_point_path', 'host_app'];

export function readParams(search = window.location.search): ExtensionParams {
  const q = new URLSearchParams(search);
  const params: ExtensionParams = {};
  for (const k of KEYS) {
    const v = q.get(k);
    if (v) params[k] = v;
  }
  return params;
}

export const isEmbedded = () => window.parent !== window;

function parentOrigin(params: ExtensionParams): string | undefined {
  try {
    return params.parent_url ? new URL(params.parent_url).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Send `extension_ready` and wait for `onestock_data` coming from the parent origin. */
export function handshake(params: ExtensionParams, timeoutMs = 10_000): Promise<OnestockData> {
  const origin = parentOrigin(params);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('handshake_timeout'));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (origin && event.origin !== origin) return;
      if (!event.data || typeof event.data !== 'object' || event.data.type !== 'onestock_data') return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve((event.data.data ?? {}) as OnestockData);
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'extension_ready' }, origin ?? '*');
  });
}

/** Ask the back office to resize the iframe to the content height (ignored by the store app). */
export function autoResize(params: ExtensionParams): () => void {
  if (!isEmbedded()) return () => {};
  const origin = parentOrigin(params) ?? '*';
  let last = 0;
  const send = () => {
    const height = Math.ceil(document.documentElement.scrollHeight);
    if (height > 0 && height !== last) {
      last = height;
      window.parent.postMessage({ type: 'extension_resize', height }, origin);
    }
  };
  const ro = new ResizeObserver(send);
  ro.observe(document.body);
  send();
  return () => ro.disconnect();
}
