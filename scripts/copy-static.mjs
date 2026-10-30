// Copies the harness's static files next to the built app.js in public/.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public', { recursive: true });
cpSync('harness/static', 'public', { recursive: true });
console.log('public/ ready');
