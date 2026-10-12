#!/usr/bin/env node
/* Tiny static server with no dependencies: `npm start` then open http://localhost:5173
 * Aborted requests are routine — a page reload or a closed tab drops sockets
 * mid-response — so every socket error is swallowed rather than left to crash the
 * process. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { hostGate } = require('./hosts');
const { siteFiles } = require('./site');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 5173;
// Loopback by default: HOST=0.0.0.0 opts in to phone testing, and what is served is the
// website alone (siteList below), not the checkout it sits in.
const host = process.env.HOST || '127.0.0.1';
// The names a request may carry in Host: loopback names, ALLOWED_HOST (a comma-separated
// list), and — bound off loopback — this machine's own names, so a phone can reach it by
// address, by hostname or by an mDNS name. The rule and its reasons are in hosts.js.
const hostAllowed = hostGate({ host, allowedHost: process.env.ALLOWED_HOST });
// The root as the filesystem names it, so that a resolved path is compared with its like.
const realRoot = fs.realpathSync.native(root);

// The website's files, as scripts/site.js lists them for the deploy: the service worker's
// SHELL and the few files beside it. Read at the start, so a sw.js with no list stops the
// server there, and again on every request, so a module just added to the shell is served
// without a restart; while sw.js is mid-edit and gives no list, the last one it gave stands.
let listed;
try {
  listed = new Set(siteFiles());
} catch (e) {
  console.error(`Ambient Noiser: ${e.message}, so there is no site to serve`);
  process.exit(1);
}
let unlisted = false;
function siteList() {
  try {
    listed = new Set(siteFiles());
    unlisted = false;
  } catch (e) {
    if (!unlisted) console.error(`Ambient Noiser: ${e.message}; serving the files it listed last`);
    unlisted = true;
  }
  return listed;
}

/** Whether a path the filesystem resolved may be served: it is one of the website's files.
 *  The address as written is not the file that opens: on Windows '\' separates too and
 *  GIT~1, the 8.3 short name of .git, opens .git, so `/%5C.git%5Cconfig` and `/GIT~1/config`
 *  once served .git/config past rules that split the address on '/'; anywhere, a link goes
 *  where it points. The resolved path has none of those spellings left in it, and one outside
 *  the checkout (a '..' first, or another drive's absolute path) names no file of the list. */
function servable(real) {
  return siteList().has(path.relative(realRoot, real).split(path.sep).join('/'));
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
  // web page from reading this server, and it is the first answer, before the path is even
  // looked at. A request that claims no name at all is answered: a browser always
  // sends Host and a page cannot set it, so the only clients that arrive without one
  // are `curl --http1.0` and raw-socket probes on loopback.
  if (!hostAllowed(req.headers.host)) {
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
  // Every other control character (DEL included) goes the same way, so a raw CR or LF
  // cannot reach a header either.
  if (/[\u0000-\u001f\u007f]/.test(url)) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (path.relative(root, file).startsWith('..')) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    // .native: on Windows it is the call that answers a short name with the long one
    fs.realpath.native(file, (err1, real) => {
      if (res.writableEnded || res.destroyed) return;
      if (err1 || !servable(real)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      fs.readFile(real, (err2, data) => {
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
