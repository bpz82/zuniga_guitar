// Plain JavaScript on purpose, so it runs on any Node and explains the problem
// instead of failing with a confusing TypeScript error.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `Zuniga Guitar needs Node 22.18 or newer (found ${process.versions.node}).\n` +
      'Node 22.18+ runs the TypeScript tests directly, with no build step.\n' +
      'Node 20 reached end of life on 2026-04-30 and Supabase\'s JavaScript\n' +
      'libraries dropped support for it on 2026-06-30. Install Node 22 or 24 LTS.',
  );
  process.exit(1);
}
