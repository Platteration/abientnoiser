#!/usr/bin/env node
/* Tiny static server with no dependencies: `npm start` then open http://localhost:5173
 * Aborted requests are routine — a page reload or a closed tab drops sockets
 * mid-response — so every socket error is swallowed rather than left to crash the
 * process. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  req.on('error', () => {});
  res.on('error', () => {});

  const url = decodeURIComponent(req.url.split('?')[0]);
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

server.listen(port, () => console.log(`Ambient Noiser: http://localhost:${port}`));
