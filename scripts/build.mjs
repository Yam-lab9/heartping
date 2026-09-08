import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
for (const file of ['server.js', 'backend.js', 'supabase-store.js', 'public/app.js', 'public/firebase-service.js', 'public/sw.js']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
for (const icon of manifest.icons) {
  const bytes = fs.readFileSync(path.join('public', icon.src));
  if (bytes.subarray(1,4).toString() !== 'PNG' || `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` !== icon.sizes) throw new Error('Invalid icon: ' + icon.src);
}
const html = fs.readFileSync('public/index.html', 'utf8');
for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!asset.startsWith('http') && !fs.existsSync(path.join('public', asset))) throw new Error('Missing asset: ' + asset);
}
if (fs.readFileSync('public/manifest.json','utf8') !== fs.readFileSync('public/manifest.webmanifest','utf8')) throw new Error('Manifest aliases differ');
fs.cpSync('public', 'app/src/main/assets/www', { recursive: true });
console.log('PASS: syntax, manifest icons, HTML assets; Android asset mirror synchronized.');
