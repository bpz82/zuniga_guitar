/**
 * Web Push with no dependencies: payload encryption (RFC 8291, aes128gcm)
 * and VAPID signing (RFC 8292), built only on the platform's WebCrypto, so
 * the same file runs in Node (tests) and Deno (Supabase Edge Functions).
 * No custom cryptography: ECDH, HKDF-style HMAC steps, AES-GCM and ECDSA
 * all come from WebCrypto. Checked against the RFC 8291 worked example.
 */

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', concat(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, concat(data)));
}

/** A P-256 key pair as raw bytes: public 65 bytes (uncompressed), private 32 bytes. */
export interface RawKeyPair {
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly privateKey: Uint8Array<ArrayBuffer>;
}

function jwk(pair: RawKeyPair): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(pair.publicKey.slice(1, 33)),
    y: b64url(pair.publicKey.slice(33, 65)),
    d: b64url(pair.privateKey),
  };
}

export async function generateKeyPair(): Promise<RawKeyPair> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const d = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d!;
  return { publicKey, privateKey: fromB64url(d) };
}

const RECORD_SIZE = 4096;

/**
 * Encrypts a push message for one subscription (RFC 8291). `salt` and
 * `serverKeys` are random per message; pass them only to reproduce a known
 * example in tests.
 */
export async function encrypt(
  plaintext: Uint8Array,
  subscription: { p256dh: Uint8Array; auth: Uint8Array },
  fixed: { salt?: Uint8Array; serverKeys?: RawKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > RECORD_SIZE - 17) throw new RangeError('push payload too large');
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server = fixed.serverKeys ?? (await generateKeyPair());
  const uaPublic = await crypto.subtle.importKey('raw', concat(subscription.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const asPrivate = await crypto.subtle.importKey('jwk', jwk(server), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, asPrivate, 256));

  // HKDF-SHA-256 as laid out in RFC 8291 section 3.4 (each expand is one HMAC block).
  const keyInfo = concat(enc.encode('WebPush: info\0'), subscription.p256dh, server.publicKey, new Uint8Array([1]));
  const ikm = await hmac(await hmac(subscription.auth, ecdh), keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // single, final record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = server.publicKey.length;
  return concat(header, server.publicKey, ciphertext);
}

/** The application server's identity (VAPID). Public key goes in the app; private key stays on the server. */
export interface Vapid {
  /** base64url, 65 bytes. */
  readonly publicKey: string;
  /** base64url, 32 bytes. Server secret. */
  readonly privateKey: string;
  /** Contact for the push service, "mailto:you@example.com" or an https URL. */
  readonly subject: string;
}

/** The Authorization header value for a push to `endpoint` (RFC 8292). Valid 12 hours. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now: number): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject })),
  );
  const pair = { publicKey: fromB64url(vapid.publicKey), privateKey: fromB64url(vapid.privateKey) };
  const key = await crypto.subtle.importKey('jwk', jwk(pair), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

export interface Subscription {
  readonly endpoint: string;
  /** base64url, from PushSubscription.toJSON().keys */
  readonly p256dh: string;
  readonly auth: string;
}

/** A ready-to-send push request. `topic` lets a newer reminder replace an undelivered older one. */
export async function pushRequest(
  sub: Subscription,
  message: object,
  vapid: Vapid,
  now: number,
  options: { ttlSeconds?: number; topic?: string } = {},
): Promise<{ url: string; init: RequestInit }> {
  const body = await encrypt(enc.encode(JSON.stringify(message)), { p256dh: fromB64url(sub.p256dh), auth: fromB64url(sub.auth) });
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid, now),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttlSeconds ?? 3600),
    Urgency: 'normal',
  };
  if (options.topic) headers.Topic = options.topic;
  return { url: sub.endpoint, init: { method: 'POST', headers, body } };
}
