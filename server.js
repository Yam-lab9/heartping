import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './backend.js';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
export function createServer({ dataFile = process.env.DATA_FILE || path.join(ROOT, 'data', 'heartping.json') } = {}) {
  dataFile = path.resolve(dataFile);
  const relativeData = path.relative(PUBLIC, dataFile);
  if (relativeData === '' || (!relativeData.startsWith('..' + path.sep) && !path.isAbsolute(relativeData))) {
    throw new Error('DATA_FILE must be outside the public directory.');
  }
  // Fail deployment early if the configured storage cannot be written.
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const probe = path.join(path.dirname(dataFile), `.heartping-write-check-${process.pid}`);
  fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
  fs.unlinkSync(probe);
  const api = createBackend(dataFile);
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    let pathname;
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('Invalid request target');
      pathname = decodeURIComponent(req.url.split('?')[0]);
    }
    catch { res.writeHead(400); return res.end('Bad request'); }
    if (pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}');
    }
    if (pathname.startsWith('/api/')) return api(req, res, pathname);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Method not allowed'); }
    if (pathname === '/') pathname = '/index.html';
    const filename = path.resolve(PUBLIC, '.' + pathname);
    const relative = path.relative(PUBLIC, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative) || pathname.includes('\\') || pathname.includes('\0')) {
      res.writeHead(403); return res.end('Forbidden');
    }
    try {
      const contents = await fs.promises.readFile(filename);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', 'Content-Length': contents.length });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      res.writeHead(['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      res.end('File unavailable');
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production' && !process.env.DATA_FILE) {
    throw new Error('Production requires DATA_FILE pointing to a persistent disk outside public/.');
  }
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => console.log(`HeartPing listening on ${host}:${server.address().port}`));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
