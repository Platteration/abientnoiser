#!/usr/bin/env node
/* Tiny static server with no dependencies: `npm start` then open http://localhost:5173
 * Aborted requests are routine — a page reload or a closed tab drops sockets
 * mid-response — so every socket error is swallowed rather than left to crash the
 * process. */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 5173;
// Loopback by default: this serves the whole checkout, which is nobody else's
// business on a shared network. HOST=0.0.0.0 opts in to phone testing.
const host = process.env.HOST || '127.0.0.1';

/**
 * The name in a Host header, without its port. A bare IPv6 literal carries no
 * port — RFC 7230 requires brackets for that — so stripping `:\d+$` from one
 * turned `::1` into `:` and made that entry unmatchable.
 */
function hostName(raw) {
  const h = String(raw ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1) || h; // bracketed IPv6: the port is outside
  return h.indexOf(':') === h.lastIndexOf(':') ? h.replace(/:\d+$/, '') : h;
}

// The names a request may carry in Host. Loopback names only by default, so a page the
// developer visits cannot reach this server by pointing its own hostname at 127.0.0.1.
// ALLOWED_HOST adds one more name for anyone who really does front this with something
// else; it goes through the same normalisation, so `dev.example.com:8080` is the name it
// looks like and not a value nothing can ever match.
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'].concat(process.env.ALLOWED_HOST ? [hostName(process.env.ALLOWED_HOST)] : []));
// Bound off loopback for phone testing, the phone types one of this machine's own
// addresses, so every interface address is a name this server answers to — in both
// spellings, since hostName() keeps the brackets of a bracketed IPv6 literal. A server on
// loopback never adds them: there a LAN address in Host is as foreign as any other name.
const lan = !['127.0.0.1', '::1', 'localhost'].includes(host);
if (lan) {
  HOSTS.add(hostName(host)).add(hostName(`[${host}]`));
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const { address } of addresses || []) HOSTS.add(hostName(address)).add(hostName(`[${address}]`));
  }
}
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  req.on('error', () => {});
  res.on('error', () => {});

  // Binding to loopback stops a network peer; it does not stop a browser that has been
  // told the attacker's own name resolves to 127.0.0.1 (DNS rebinding). The rebound
  // request still carries that name in Host, so this is the check that keeps a visited
  // web page out of the checkout, and it is the first answer, before the path is even
  // looked at. A request that claims no name at all cannot be a rebound one: a browser
  // always sends Host and a page cannot set it, so the only clients this refuses are
  // `curl --http1.0` and raw-socket probes on loopback. Off loopback, a name under
  // .local is answered too: that is mDNS (RFC 6762), which is what a phone types for
  // this machine and which no internet DNS can point at 127.0.0.1.
  const name = hostName(req.headers.host);
  if (name && !HOSTS.has(name) && !(lan && name.endsWith('.local'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch { // a malformed percent-escape is a bad request, not a reason to fall over
    res.writeHead(400);
    return res.end('Bad request');
  }
  // fs.stat throws synchronously on a NUL byte, which would take the process with it.
  // Every other control character goes the same way, so a raw CR or LF cannot reach a
  // header either.
  if (/[\u0000-\u001f]/.test(url)) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  // .git, .github and friends live inside the root, so the traversal guard misses them
  if (url.split('/').some((part) => part.startsWith('.') && part !== '.' && part !== '..')) {
    res.writeHead(404);
    return res.end('Not found');
  }
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (path.relative(root, file).startsWith('..')) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (res.writableEnded || res.destroyed) return;
      if (err2) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});
server.on('error', (err) => {
  console.error(`Ambient Noiser: server error — ${err.message}`);
  process.exit(1);
});

server.listen(port, host, () => console.log(`Ambient Noiser: http://localhost:${port}`));
