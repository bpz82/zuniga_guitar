// Builds the app into public/ (Vercel runs this). The three public settings
// come from Vercel environment variables, so nobody types them on a device:
//   ZG_SUPABASE_URL, ZG_SUPABASE_PUBLISHABLE_KEY, ZG_VAPID_PUBLIC_KEY
// All three are public by design. A secret key is refused, so it can never
// be baked into the app by mistake.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('node', ['scripts/check-vendor.mjs']);

const config = {
  supabaseUrl: (process.env.ZG_SUPABASE_URL ?? '').trim(),
  publishableKey: (process.env.ZG_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
  vapidPublicKey: (process.env.ZG_VAPID_PUBLIC_KEY ?? '').trim(),
};

function looksSecret(value) {
  if (/sb_secret_|service_role/.test(value)) return true;
  const parts = value.split('.');
  if (parts.length === 3 && value.startsWith('eyJ')) {
    try {
      return /service_role/.test(Buffer.from(parts[1], 'base64url').toString());
    } catch {
      return false;
    }
  }
  return false;
}
for (const [name, value] of Object.entries(config)) {
  if (looksSecret(value)) {
    console.error(`Refusing to build: ${name} looks like a SECRET key. Only the publishable key belongs in the app.`);
    process.exit(1);
  }
}
if (config.supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl.replace(/\/$/, ''))) {
  console.error('Refusing to build: ZG_SUPABASE_URL should look like https://<ref>.supabase.co');
  process.exit(1);
}

run('esbuild', [
  'harness/main.ts',
  '--bundle',
  '--format=esm',
  '--target=es2022',
  '--outfile=public/app.js',
  `--define:__ZG_CONFIG__=${JSON.stringify(config)}`,
]);
mkdirSync('public', { recursive: true });
cpSync('harness/static', 'public', { recursive: true });
const set = Object.entries(config).filter(([, v]) => v).map(([k]) => k);
console.log(`public/ ready (${set.length ? `built-in: ${set.join(', ')}` : 'no built-in connection; enter it in the app'})`);
