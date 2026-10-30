/**
 * Web Push crypto checked against RFC 8291's worked example (Appendix A and
 * section 5), plus VAPID signatures verified with WebCrypto.
 * https://datatracker.ietf.org/doc/html/rfc8291
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64url, encrypt, fromB64url, generateKeyPair, pushRequest, vapidAuthorization } from '../supabase/functions/_shared/webpush.ts';

const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('base64url round-trips', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(fromB64url(b64url(bytes)), bytes);
  assert.equal(new TextDecoder().decode(fromB64url(RFC.plaintext)), 'When I grow up, I want to be a watermelon');
});

test('encryption reproduces the RFC 8291 example byte for byte', async () => {
  const out = await encrypt(
    fromB64url(RFC.plaintext),
    { p256dh: fromB64url(RFC.uaPublic), auth: fromB64url(RFC.auth) },
    { salt: fromB64url(RFC.salt), serverKeys: { publicKey: fromB64url(RFC.asPublic), privateKey: fromB64url(RFC.asPrivate) } },
  );
  assert.equal(b64url(out), RFC.message);
});

/** Decrypts as a browser would (the receiving side of RFC 8291), to check random-key messages. */
async function decrypt(message: Uint8Array, uaPublic: Uint8Array, uaPrivate: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = message.slice(0, 16);
  const idlen = message[20]!;
  const asPublic = message.slice(21, 21 + idlen);
  const ciphertext = message.slice(21 + idlen);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(uaPublic.slice(1, 33)), y: b64url(uaPublic.slice(33)), d: b64url(uaPrivate) };
  const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
  const h = async (k: Uint8Array, d: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new Uint8Array(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new Uint8Array(d)),
    );
  const te = new TextEncoder();
  const cat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));
  const ikm = await h(await h(auth, ecdh), cat(te.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await h(salt, ikm);
  const cek = (await h(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await h(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  assert.equal(padded.at(-1), 2, 'final record delimiter');
  return new TextDecoder().decode(padded.slice(0, -1));
}

test('a fresh message with random keys decrypts on the receiving side', async () => {
  const ua = await generateKeyPair();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = JSON.stringify({ title: 'Pocket burst', body: '5 minutes, silent' });
  const message = await encrypt(new TextEncoder().encode(text), { p256dh: ua.publicKey, auth });
  assert.equal(await decrypt(message, ua.publicKey, ua.privateKey, auth), text);
  const second = await encrypt(new TextEncoder().encode(text), { p256dh: ua.publicKey, auth });
  assert.notEqual(b64url(second), b64url(message), 'new salt and key every time');
});

test('oversized payloads are refused', async () => {
  const ua = await generateKeyPair();
  await assert.rejects(encrypt(new Uint8Array(5000), { p256dh: ua.publicKey, auth: new Uint8Array(16) }), RangeError);
});

test('VAPID: a valid ES256 token for the push service origin, verifiable with the public key', async () => {
  const pair = await generateKeyPair();
  const vapid = { publicKey: b64url(pair.publicKey), privateKey: b64url(pair.privateKey), subject: 'mailto:support@example.com' };
  const now = Date.UTC(2026, 10, 2, 13);
  const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH/abc', vapid, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  assert.ok(m, header);
  const [, h, c, sig, k] = m;
  assert.equal(k, vapid.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(h!))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c!)));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:support@example.com');
  assert.equal(claims.exp, now / 1000 + 12 * 3600);
  const pub = await crypto.subtle.importKey('raw', pair.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(sig!), new TextEncoder().encode(`${h}.${c}`));
  assert.ok(valid);
});

test('push request: right headers, encrypted body, short TTL so stale reminders are dropped', async () => {
  const server = await generateKeyPair();
  const ua = await generateKeyPair();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const vapid = { publicKey: b64url(server.publicKey), privateKey: b64url(server.privateKey), subject: 'mailto:a@b.c' };
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', p256dh: b64url(ua.publicKey), auth: b64url(auth) };
  const { url, init } = await pushRequest(sub, { title: 'Morning session' }, vapid, Date.now(), { topic: 'zg-morning' });
  const headers = init.headers as Record<string, string>;
  assert.equal(url, sub.endpoint);
  assert.equal(init.method, 'POST');
  assert.equal(headers['Content-Encoding'], 'aes128gcm');
  assert.equal(headers.TTL, '3600');
  assert.equal(headers.Topic, 'zg-morning');
  assert.match(headers.Authorization!, /^vapid t=.+, k=/);
  assert.equal(await decrypt(init.body as Uint8Array, ua.publicKey, ua.privateKey, auth), JSON.stringify({ title: 'Morning session' }));
});
