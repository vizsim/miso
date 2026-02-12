import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const UA = 'miso/0.1 (+https://github.com/vizsim/miso)';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function safeLocalPath(urlPathname) {
  const clean = decodeURIComponent(urlPathname.split('?')[0]);
  const normalized = path.normalize(clean).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(ROOT, normalized);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const abs = safeLocalPath(reqPath || '/index.html');
  if (!abs) return sendNotFound(res);

  fs.stat(abs, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      return sendNotFound(res);
    }
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(abs).pipe(res);
  });
}

function proxyTransitous(req, res) {
  const rawPath = req.url || '/';
  const rewrittenPath = rawPath.replace(/^\/transitous/, '');
  const targetPath = rewrittenPath.startsWith('/api/') ? rewrittenPath : `/api${rewrittenPath}`;

  const headers = {
    Accept: req.headers.accept || 'application/json',
    'User-Agent': UA,
    Referer: req.headers.referer || 'http://localhost:3000/'
  };

  const options = {
    protocol: 'https:',
    hostname: 'api.transitous.org',
    method: req.method || 'GET',
    path: targetPath,
    headers
  };

  const upstreamReq = https.request(options, (upstreamRes) => {
    const outHeaders = { ...upstreamRes.headers };
    delete outHeaders['access-control-allow-origin'];
    res.writeHead(upstreamRes.statusCode || 502, outHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'proxy_error', message: err.message } }));
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    upstreamReq.end();
    return;
  }
  req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
  if (!req.url) return sendNotFound(res);
  if (req.url.startsWith('/transitous/') || req.url.startsWith('/api/')) {
    return proxyTransitous(req, res);
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[miso-dev] http://localhost:${PORT}`);
  console.log('[miso-dev] Proxy: /transitous/* and /api/* -> https://api.transitous.org/*');
});

