// Makes a VAPID key pair and a cron secret, printed on YOUR screen only.
// Never paste these into a chat. See docs/SETUP.md for where each one goes.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const b64url = (b) => Buffer.from(b).toString('base64url');
const pub = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
const cron = b64url(crypto.getRandomValues(new Uint8Array(32)));
console.log(`
VAPID_PUBLIC_KEY   (public: goes in the app and in Supabase secrets)
${pub}

VAPID_PRIVATE_KEY  (SECRET: Supabase Edge Function secrets only)
${priv}

CRON_SECRET        (SECRET: Supabase Edge Function secrets and Vault only)
${cron}
`);
