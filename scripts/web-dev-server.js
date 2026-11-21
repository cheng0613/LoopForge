'use strict';

// Local dev server for the web UI.
//
// The platform embeds web/ into its binary, so a change to web/ cannot be seen
// without rebuilding the image. This serves web/ from disk instead and proxies
// everything that is not a static file to a running platform, so front-end work
// is edit-and-refresh.
//
//   node scripts/web-dev-server.js            # http://127.0.0.1:5180
//   node scripts/web-dev-server.js --port 5200 --api http://127.0.0.1:8090
//
// Only for development: it trusts the local platform and adds no auth of its own.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(arg('port', 5180));
const API = arg('api', 'http://127.0.0.1:8090').replace(/\/+$/, '');
const WEB_ROOT = path.join(__dirname, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve a request path inside web/, refusing traversal. */
function resolveStatic(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = clean === '/' ? '/index.html' : clean;
  const full = path.join(WEB_ROOT, rel);
  if (!full.startsWith(WEB_ROOT)) return null;
  return full;
}

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    // No caching: the point is to see edits immediately.
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

/** Proxy a request to the platform, preserving method, headers and body. */
function proxy(req, res) {
  const target = new URL(req.url, API);

  // The platform rejects any request whose Origin host differs from its own
  // Host header (cors() in gin_helpers.go). Talking to it as a different origin
  // therefore fails login with "cross-origin request denied". Rewrite both to
  // the upstream, which is safe here: this server is dev-only and loopback.
  const headers = { ...req.headers, host: target.host };
  if (headers.origin) headers.origin = `${target.protocol}//${target.host}`;
  if (headers.referer) headers.referer = `${target.protocol}//${target.host}/`;

  const opts = {
    hostname: target.hostname,
    port: target.port || 80,
    path: target.pathname + target.search,
    method: req.method,
    headers,
  };

  const upstream = http.request(opts, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[proxy]', req.method, req.url, '->', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'platform unreachable: ' + err.message }));
    }
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const file = resolveStatic(req.url || '/');

  // Static first: an existing file on disk wins. Anything else (API, streams,
  // websockets' HTTP handshake) goes to the platform.
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return serveFile(res, file);
  }

  proxy(req, res);
});

// WebSocket upgrade also belongs to the platform (run logs, chat streams).
server.on('upgrade', (req, socket, head) => {
  const target = new URL(req.url, API);
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  });

  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n'
    );
    if (upHead && upHead.length) socket.write(upHead);
    upSocket.pipe(socket).pipe(upSocket);
    upSocket.on('error', () => socket.destroy());
    socket.on('error', () => upSocket.destroy());
  });

  upstream.on('error', () => socket.destroy());
  upstream.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`web dev server  http://127.0.0.1:${PORT}`);
  console.log(`  static : ${WEB_ROOT}`);
  console.log(`  proxied: ${API}`);
});
