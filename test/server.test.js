const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
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

/** Spawn the real server (or `args` for node, a copy of it in a tree of its own);
 *  `stderr()` hands back what it has logged so far. */
async function started(onPort, env, t, args = [serve]) {
  const server = spawn(process.execPath, args, { env: { ...process.env, ...env, PORT: String(onPort) }, stdio: ['ignore', 'ignore', 'pipe'] });
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

/** A checkout of its own: the dev server's two files, a page, and a dot-named folder with a
 *  file in it. The server serves the folder its own script sits under, so a copy serves this
 *  tree, and a test can put links in it that the repository does not have. */
function checkout(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'an-serve-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const tree = path.join(base, 'checkout');
  fs.mkdirSync(path.join(tree, 'scripts'), { recursive: true });
  for (const f of ['serve.js', 'hosts.js']) fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(tree, 'scripts', f));
  fs.writeFileSync(path.join(tree, 'index.html'), '<!DOCTYPE html><title>page</title>');
  fs.mkdirSync(path.join(tree, '.secret'));
  fs.writeFileSync(path.join(tree, '.secret', 'key.txt'), 'not for the network');
  fs.writeFileSync(path.join(base, 'outside.txt'), 'not in the checkout');
  return { base, tree, script: path.join(tree, 'scripts', 'serve.js') };
}

// The dot-folder and traversal rules read the address as it is written, split on '/'. What
// opens is up to the filesystem, which follows a link wherever it points — so the answer is
// decided again on the path the filesystem resolves.
test('the dev server decides on the file the filesystem opens, not on how the address is spelled', async (t) => {
  const { base, tree, script } = checkout(t);
  fs.symlinkSync('.secret', path.join(tree, 'alias'));
  fs.symlinkSync(path.join(base, 'outside.txt'), path.join(tree, 'elsewhere.txt'));
  const p = port + 3;
  await started(p, {}, t, [script]);
  assert.equal((await raw(p, '/index.html', 'localhost')).status, 200, 'the page');
  assert.equal((await raw(p, '/.secret/key.txt', 'localhost')).status, 404, 'a dot folder by its own name');
  assert.equal((await raw(p, '/alias/key.txt', 'localhost')).status, 404, 'nor by a link to it');
  assert.equal((await raw(p, '/elsewhere.txt', 'localhost')).status, 404, 'nor a file outside the checkout by a link to it');
});

/** Windows, as far as serve.js can tell: `path` is path.win32, and the filesystem resolves a
 *  path the way NTFS does — '\' separates as well as '/', an 8.3 short name opens the folder
 *  it abbreviates (SECRET~1 is .secret's: the leading dot is dropped), and the checkout is on
 *  C: while the folder named in OTHER_DRIVE is D:. Only serve.js is handed these, through
 *  --require, so Node's own loader is untouched. This is the platform's path rules, not a
 *  Windows host: CI has none. */
const WINDOWS = String.raw`
const Module = require('module');
const fs = require('fs');
const path = require('path');
const SHORT = { 'SECRET~1': '.secret', 'SCRIPT~1': 'scripts' };
const OTHER = process.env.OTHER_DRIVE;
const long = (part) => (Object.hasOwn(SHORT, part.toUpperCase()) ? SHORT[part.toUpperCase()] : part);
const local = (p) => {
  const drive = /^[a-z]:/i.test(p) ? p[0].toUpperCase() : '';
  return (drive === 'D' ? OTHER : '') + p.slice(drive ? 2 : 0).split('\\').map(long).join('/');
};
const windows = (p) => (p === OTHER || p.startsWith(OTHER + '/') ? 'D:' + p.slice(OTHER.length) : 'C:' + p).split('/').join('\\');
const fsWindows = {
  ...fs,
  stat: (p, ...rest) => fs.stat(local(p), ...rest),
  readFile: (p, ...rest) => fs.readFile(local(p), ...rest),
  realpath: Object.assign((p, ...rest) => fs.realpath(local(p), ...rest), {
    native: (p, ...rest) => { const cb = rest.pop(); fs.realpath.native(local(p), ...rest, (err, real) => cb(err, real && windows(real))); },
  }),
  realpathSync: Object.assign((p, ...rest) => windows(fs.realpathSync(local(p), ...rest)), {
    native: (p, ...rest) => windows(fs.realpathSync.native(local(p), ...rest)),
  }),
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && /[\\/]serve\.js$/.test(parent.filename || '')) {
    if (request === 'path' || request === 'node:path') return path.win32;
    if (request === 'fs' || request === 'node:fs') return fsWindows;
  }
  return load.call(this, request, parent, ...rest);
};
`;

// On Windows `/%5C.git%5Cconfig` was `\.git\config` to the filesystem and one harmless-looking
// segment to a rule that split on '/', and `/GIT~1/config` named no dot folder at all: both
// served .git/config — to the whole network under HOST=0.0.0.0. And a link to another drive
// has no '..' to find: path.relative answers it with the other drive's own absolute path.
test('on Windows, a backslash, an 8.3 short name or another drive does not get past the rules', async (t) => {
  const { base, tree, script } = checkout(t);
  const preload = path.join(base, 'windows.js');
  fs.writeFileSync(preload, WINDOWS);
  const other = fs.realpathSync(fs.mkdtempSync(path.join(base, 'd-')));
  fs.writeFileSync(path.join(other, 'outside.txt'), 'on another drive');
  fs.symlinkSync(path.join(other, 'outside.txt'), path.join(tree, 'elsewhere.txt'));
  const p = port + 4;
  await started(p, { OTHER_DRIVE: other }, t, ['--require', preload, script]);
  // these two show the platform's rules are the ones in force: neither file exists on Linux
  assert.equal((await raw(p, '/scripts%5Chosts.js', 'localhost')).status, 200, 'a backslash separates');
  assert.equal((await raw(p, '/SCRIPT~1/hosts.js', 'localhost')).status, 200, 'and a short name opens its folder');
  assert.equal((await raw(p, '/%5C.secret%5Ckey.txt', 'localhost')).status, 404, 'a dot folder behind backslashes');
  assert.equal((await raw(p, '/scripts%5C..%5C.secret%5Ckey.txt', 'localhost')).status, 404, 'or behind a step back');
  assert.equal((await raw(p, '/SECRET~1/key.txt', 'localhost')).status, 404, 'or by its 8.3 short name');
  assert.equal((await raw(p, '/secret~1/key.txt', 'localhost')).status, 404, 'in any case');
  assert.equal((await raw(p, '/elsewhere.txt', 'localhost')).status, 404, 'nor a file on another drive by a link to it');
  assert.equal((await raw(p, '/index.html', 'localhost')).status, 200, 'and the page is still served');
});
