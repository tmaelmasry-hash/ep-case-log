// WebCrypto only (no node:crypto), so the same code runs on Node and on Cloudflare.
import { b64url } from './util.ts';

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

/** Purpose-bound HMAC key derived from the session secret (HKDF-SHA256). */
function hmacKey(secret: string, label: string): Promise<CryptoKey> {
  const k = `${label}\u0000${secret}`;
  let p = keyCache.get(k);
  if (!p) {
    p = (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(`ep-case-log/${label}`) },
        base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign'],
      );
    })();
    keyCache.set(k, p);
  }
  return p;
}

export async function hmac(secret: string, label: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, label), enc.encode(data));
  return b64url(new Uint8Array(sig));
}
