const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const serve = path.resolve(__dirname, '..', 'scripts', 'serve.js');
const port = 5700 + Math.floor(Math.random() * 200);

function get(pathname) {
  return fetch(`http://localhost:${port}${pathname}`).then(
    (r) => ({ status: r.status }),
    (e) => ({ error: e.cause ? e.cause.code || String(e.cause) : String(e) })
  );
}

/** A request with the Host header spelled out. fetch() (undici) refuses to set Host, and
 *  a browser cannot either, which is the whole reason the header is worth checking;
 *  http.request will send whatever it is given. */
function raw(onPort, pathname, hostHeader) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: onPort, path: pathname, headers: { Host: hostHeader }, setHost: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', (e) => resolve({ error: e.code || String(e) }));
    req.end();
  });
}

/** A request with no Host at all. Node answers 400 to an HTTP/1.1 request without one
 *  before any handler runs (requireHostHeader), so the client that reaches the handler
 *  with none is an HTTP/1.0 one — `curl --http1.0`, or a raw probe like this. */
function http10(onPort, pathname) {
  return new Promise((resolve) => {
    const sock = net.connect(onPort, '127.0.0.1', () => sock.write(`GET ${pathname} HTTP/1.0\r\n\r\n`));
    let data = '';
    sock.on('data', (d) => { data += d; });
    sock.on('end', () => resolve({ status: Number((data.match(/^HTTP\/1\.[01] (\d+)/) || [])[1]) }));
    sock.on('error', (e) => resolve({ error: e.code || String(e) }));
  });
}

/** Spawn the real server; `stderr()` hands back what it has logged so far. */
async function started(onPort, env, t) {
  const server = spawn(process.execPath, [serve], { env: { ...process.env, ...env, PORT: String(onPort) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  server.stderr.on('data', (d) => { err += d; });
  t.after(() => server.kill());
  for (let i = 0; i < 50; i++) {
    if ((await raw(onPort, '/index.html', `localhost:${onPort}`)).status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { server, stderr: async () => { await new Promise((r) => setTimeout(r, 50)); return err; } };
}

/** One address a phone on the LAN would type: the first non-internal IPv4, if any. */
function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses || []) if (!a.internal && a.family === 'IPv4') return a.address;
  }
  return null;
}

test('the dev server survives the requests a browser actually makes', async (t) => {
  const server = spawn(process.execPath, [serve], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  t.after(() => server.kill());
  for (let i = 0; i < 50; i++) {
    if ((await get('/index.html')).status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.equal((await get('/index.html')).status, 200, 'serves the page');

  // a malformed percent-escape is a bad request, not a crash
  assert.equal((await get('/%zz')).status, 400, 'rejects a malformed escape');
  assert.equal((await get('/index.html')).status, 200, 'still alive after a malformed URL');

  // a NUL byte reaches fs.stat, which throws synchronously and took the process with it
  assert.equal((await get('/%00')).status, 400, 'rejects a NUL byte in the path');
  assert.equal((await get('/js/%00app.js')).status, 400, 'rejects a NUL byte mid-path');
  assert.equal((await get('/index.html')).status, 200, 'still alive after a NUL byte');
  // and every other control character goes the same way, so a raw CR or LF cannot reach a header
  assert.equal((await get('/a%0d%0aX-Evil:%201')).status, 400, 'rejects CR LF in the path');
  assert.equal((await get('/index.html%09')).status, 400, 'rejects a tab in the path');

  // the checkout is not the site: dotfiles stay unreachable even though they are in the root
  assert.equal((await get('/.git/HEAD')).status, 404, 'does not serve the git directory');
  assert.equal((await get('/.github/workflows/ci.yml')).status, 404, 'does not serve the workflows');

  // nothing outside the project is reachable
  assert.equal((await get('/../../etc/passwd')).status, 404);
  assert.equal((await get('/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status, 403);
  assert.equal((await get('/index.html')).status, 200, 'still alive after traversal attempts');

  // aborted requests must not take it down either
  await Promise.all(Array.from({ length: 40 }, () => {
    const ac = new AbortController();
    const p = fetch(`http://localhost:${port}/js/app.js`, { signal: ac.signal }).catch(() => {});
    setTimeout(() => ac.abort(), Math.random() * 8);
    return p;
  }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await get('/index.html')).status, 200, 'still alive after aborted requests');
});

// Binding to loopback stops a network peer, not a browser that has been told the
// attacker's own name resolves to 127.0.0.1 (DNS rebinding): that request arrives on
// loopback carrying the attacker's name in Host. A browser cannot send a request without
// Host and a page cannot set it, so a request with none is not a rebound one.
test('the dev server answers to its own names and refuses a rebound one', async (t) => {
  const p = port + 1;
  const { stderr } = await started(p, { ALLOWED_HOST: 'front.example:8080, other.example' }, t);
  assert.equal((await raw(p, '/index.html', `localhost:${p}`)).status, 200, 'its own name');
  assert.equal((await raw(p, '/index.html', `front.example:${p}`)).status, 200, 'a name from ALLOWED_HOST, whatever port it was written with');
  assert.equal((await raw(p, '/index.html', 'other.example')).status, 200, 'and the second name of the list');
  assert.equal((await raw(p, '/index.html', 'front.example.evil')).status, 403, 'but not a name that merely starts with one');
  assert.equal((await raw(p, '/index.html', `127.0.0.1:${p}`)).status, 200, 'its own address');
  assert.equal((await raw(p, '/index.html', `[::1]:${p}`)).status, 200, 'its own IPv6 address, with the port outside the brackets');
  assert.equal((await raw(p, '/index.html', '::1')).status, 200, 'a bare IPv6 literal carries no port, so its last group is not one');
  assert.equal((await raw(p, '/index.html', 'LOCALHOST')).status, 200, 'case does not matter');
  assert.equal((await http10(p, '/index.html')).status, 200, 'no Host at all is not a rebound browser');
  assert.equal((await raw(p, '/index.html', 'evil.example')).status, 403, 'a rebound name is refused');
  assert.equal((await raw(p, '/index.html', `evil.example:${p}`)).status, 403, 'with a port too');
  assert.equal((await raw(p, '/js/app.js', 'localhost.evil.example')).status, 403, 'and a name that merely starts with one of ours');
  assert.equal((await raw(p, '/%zz', 'evil.example')).status, 403, 'refused before the path is even decoded, so a rebound page learns nothing from the status');
  assert.equal((await raw(p, '/index.html', `laptop.local:${p}`)).status, 403, 'on loopback an mDNS name is as foreign as any other');
  const lan = lanAddress();
  if (lan) assert.equal((await raw(p, '/index.html', `${lan}:${p}`)).status, 403, 'on loopback, this machine\'s LAN address is as foreign as any other name');
  assert.equal((await raw(p, '/index.html', `localhost:${p}`)).status, 200, 'still alive after the refusals');
  // a refusal is explained on the terminal, once per name
  await raw(p, '/index.html', 'evil.example:5173');
  const log = await stderr();
  assert.equal((log.match(/refused Host "evil.example"/g) || []).length, 1, `evil.example is logged once: ${log}`);
  assert.match(log, /ALLOWED_HOST=evil.example/, 'with the way to allow it');
});

// HOST=0.0.0.0 is the phone-testing mode: the phone types this machine's address, so the
// server must answer to every address it has — and still to nothing else.
test('bound to a LAN address, the dev server answers to this machine\'s own addresses', async (t) => {
  const p = port + 2;
  await started(p, { HOST: '0.0.0.0' }, t);
  const lan = lanAddress();
  if (!lan) t.diagnostic('no non-internal IPv4 interface on this machine; the LAN name itself is not exercised');
  else assert.equal((await raw(p, '/index.html', `${lan}:${p}`)).status, 200, `answers to ${lan}`);
  assert.equal((await raw(p, '/index.html', `localhost:${p}`)).status, 200, 'and still to localhost');
  assert.equal((await raw(p, '/index.html', `laptop.local:${p}`)).status, 200, 'and to an mDNS name, which a phone types and no internet DNS can rebind');
  const name = os.hostname();
  assert.equal((await raw(p, '/index.html', `${name}:${p}`)).status, 200, `and to this machine's hostname (${name})`);
  assert.equal((await raw(p, '/index.html', `${name.toUpperCase()}.local:${p}`)).status, 200, 'in any case, under .local too');
  assert.equal((await raw(p, '/index.html', 'evil.example')).status, 403, 'but not to a rebound name');
  assert.equal((await raw(p, '/index.html', 'evil.local.example')).status, 403, 'nor to a name that merely contains .local');
});
