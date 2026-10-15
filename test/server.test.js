const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const site = require('../scripts/site.js');

const serve = path.resolve(__dirname, '..', 'scripts', 'serve.js');
const port = 5700 + Math.floor(Math.random() * 200);

function get(pathname) {
  return fetch(`http://localhost:${port}${pathname}`).then(
    (r) => ({ status: r.status }),
    (e) => ({ error: e.cause ? e.cause.code || String(e.cause) : String(e) })
  );
}

function getWithHost(pathname, host) {
  return fetch(`http://localhost:${port}${pathname}`, { headers: { Host: host } }).then(
    (r) => ({ status: r.status }),
    (e) => ({ error: e.cause ? e.cause.code || String(e.cause) : String(e) })
  );
}

function getRaw(pathname, headers = {}) {
  return new Promise((resolve) => {
    const request = http.request({ hostname: 'localhost', port, path: pathname, headers }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode }));
    });
    request.on('error', (error) => resolve({ error: error.code || String(error) }));
    request.end();
  });
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
  assert.equal((await get('/index.html%7f')).status, 400, 'rejects DEL, the last control character');

  // the checkout is not the site: dotfiles stay unreachable even though they are in the root,
  // and so does every other file the site does not list (the next test walks them all)
  assert.equal((await get('/.git/HEAD')).status, 404, 'does not serve the git directory');
  assert.equal((await get('/.git/config')).status, 404, 'nor the repository\'s configuration');
  assert.equal((await get('/.github/workflows/ci.yml')).status, 404, 'does not serve the workflows');
  assert.equal((await get('/package.json')).status, 404, 'does not serve the project files');

  // nothing outside the project is reachable
  assert.equal((await get('/../../etc/passwd')).status, 404);
  assert.equal((await getRaw('/js/%2e%2e/%2e%2e/package.json')).status, 403);
  assert.equal((await get('/%00')).status, 400, 'rejects an encoded NUL');
  assert.equal((await get('/.git/config')).status, 404, 'does not expose repository metadata');
  assert.equal((await get('/package.json')).status, 404, 'does not expose project files');
  assert.equal((await getRaw('/index.html', { Host: `rebind.example:${port}` })).status, 421, 'rejects rebinding Host headers');
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

/** Every file under the checkout, as paths relative to it, but for node_modules and .git,
 *  which are named below by one file each: tracked or not, none of it is the site's unless
 *  scripts/site.js lists it. */
function checkoutFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      if (e.isDirectory()) walk(p); else out.push(p);
    }
  };
  walk('');
  return out;
}

const address = (f) => `/${f.split('/').map(encodeURIComponent).join('/')}`;

// The dev server is the website's first host, so it serves what the deploy publishes
// (scripts/site.js: the service worker's shell and the files beside it) and answers 404 for
// the rest of the checkout: the notes, the tests, the dev server's own source, the lockfile,
// the hosting configs and whatever a developer leaves lying in the tree.
test('the dev server serves the website, and nothing else of the checkout', async (t) => {
  const root = path.resolve(__dirname, '..');
  const p = port + 5;
  await started(p, {}, t);
  const files = new Set(site.siteFiles());
  assert.equal((await raw(p, '/', `localhost:${p}`)).status, 200, 'the page at /');
  for (const f of files) assert.equal((await raw(p, address(f), `localhost:${p}`)).status, 200, `serves /${f}`);
  const others = [...checkoutFiles(root).filter((f) => !files.has(f)), '.git/config', '.git/HEAD', 'node_modules/playwright/package.json'];
  for (const f of ['package.json', 'package-lock.json', 'README.md', 'CLAUDE.md', 'scripts/serve.js', 'test/server.test.js', '_headers', 'deploy/nginx.conf']) {
    assert.ok(others.includes(f), `${f} is one of the checkout's files outside the site`);
  }
  for (const f of others) assert.equal((await raw(p, address(f), `localhost:${p}`)).status, 404, `answers 404 for /${f}`);
  for (const dir of ['js/', 'css/', 'scripts/', 'test/', '.well-known/']) {
    assert.equal((await raw(p, `/${dir}`, `localhost:${p}`)).status, 404, `answers 404 for the folder /${dir}`);
  }
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

/** The site's list in a checkout of the tests' own: a page, a module in a folder with a long
 *  name, and two addresses that are links in the tree — so the list names them, and what
 *  they resolve to is what decides. */
const SHELL = ['./', './index.html', './library/page.js', './alias/key.txt', './elsewhere.txt'];
const sw = (shell) => `const VERSION = 'test';\nconst SHELL = [\n  ${shell.map((f) => `'${f}'`).join(', ')},\n];\n`;

/** A checkout of its own: the dev server's three files, a service worker whose SHELL is the
 *  list above, the files it lists, and a dot-named folder with a file in it. The server
 *  serves the website of the folder its own script sits under, so a copy serves this tree,
 *  and a test can put links and list entries in it that the repository does not have. */
function checkout(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'an-serve-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const tree = path.join(base, 'checkout');
  fs.mkdirSync(path.join(tree, 'scripts'), { recursive: true });
  for (const f of ['serve.js', 'hosts.js', 'site.js']) fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(tree, 'scripts', f));
  fs.writeFileSync(path.join(tree, 'sw.js'), sw(SHELL));
  fs.writeFileSync(path.join(tree, 'index.html'), '<!DOCTYPE html><title>page</title>');
  fs.mkdirSync(path.join(tree, 'library'));
  fs.writeFileSync(path.join(tree, 'library', 'page.js'), '// a module of the site');
  fs.mkdirSync(path.join(tree, '.secret'));
  fs.writeFileSync(path.join(tree, '.secret', 'key.txt'), 'not for the network');
  fs.writeFileSync(path.join(base, 'outside.txt'), 'not in the checkout');
  return { base, tree, script: path.join(tree, 'scripts', 'serve.js') };
}

// The traversal rule reads the address as it is written. What opens is up to the
// filesystem, which follows a link wherever it points — so whether a file is the site's is
// decided on the path the filesystem resolves, not on the address the site lists.
test('the dev server decides on the file the filesystem opens, not on how the address is spelled', async (t) => {
  const { base, tree, script } = checkout(t);
  fs.symlinkSync('.secret', path.join(tree, 'alias'));
  fs.symlinkSync(path.join(base, 'outside.txt'), path.join(tree, 'elsewhere.txt'));
  fs.symlinkSync('library', path.join(tree, 'shortcut'));
  const p = port + 3;
  await started(p, {}, t, [script]);
  assert.equal((await raw(p, '/index.html', 'localhost')).status, 200, 'the page');
  assert.equal((await raw(p, '/library/page.js', 'localhost')).status, 200, 'a module of the site');
  assert.equal((await raw(p, '/shortcut/page.js', 'localhost')).status, 200, 'and by a link to its folder, since the file that opens is the site\'s');
  assert.equal((await raw(p, '/.secret/key.txt', 'localhost')).status, 404, 'a dot folder by its own name');
  assert.equal((await raw(p, '/alias/key.txt', 'localhost')).status, 404, 'nor by a link to it, though the list names that address');
  assert.equal((await raw(p, '/elsewhere.txt', 'localhost')).status, 404, 'nor a file outside the checkout by a listed link to it');
  assert.equal((await raw(p, '/scripts/serve.js', 'localhost')).status, 404, 'nor the dev server\'s own source');
});

// The list is the service worker's, read as sw.js has it at the time of the request: a module
// added to the shell is served without a restart, a sw.js caught mid-edit leaves the last list
// standing (and says so once), and one that gives no list at all stops the server at the start.
test('the dev server reads the site\'s list as sw.js has it now', async (t) => {
  const { tree, script } = checkout(t);
  fs.writeFileSync(path.join(tree, 'library', 'new.js'), '// added while the server runs');
  const p = port + 6;
  const { stderr } = await started(p, {}, t, [script]);
  assert.equal((await raw(p, '/library/new.js', 'localhost')).status, 404, 'a file the shell does not list');
  fs.writeFileSync(path.join(tree, 'sw.js'), sw([...SHELL, './library/new.js']));
  assert.equal((await raw(p, '/library/new.js', 'localhost')).status, 200, 'listed in the shell, it is served without a restart');
  fs.writeFileSync(path.join(tree, 'sw.js'), "const VERSION = 'mid-edit';\n");
  assert.equal((await raw(p, '/library/new.js', 'localhost')).status, 200, 'while sw.js gives no list, the last one stands');
  assert.equal((await raw(p, '/index.html', 'localhost')).status, 200, 'for the page too');
  assert.equal((await raw(p, '/library/other.js', 'localhost')).status, 404, 'and nothing it did not name');
  assert.equal(((await stderr()).match(/declares no SHELL/g) || []).length, 1, 'said once on the terminal, not once a request');

  const broken = checkout(t);
  fs.writeFileSync(path.join(broken.tree, 'sw.js'), "const VERSION = 'none';\n");
  const child = spawn(process.execPath, [broken.script], { env: { ...process.env, PORT: String(port + 7) }, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => child.kill());
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.notEqual(code, 0, 'a site with no list is not served at all');
  assert.match(err, /Ambient Noiser: .*declares no SHELL/, `and the terminal says why: ${err}`);
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
const SHORT = { 'SECRET~1': '.secret', 'SCRIPT~1': 'scripts', 'LIBRAR~1': 'library' };
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
  // these two show the platform's rules are the ones in force: neither address names a file on Linux
  assert.equal((await raw(p, '/library%5Cpage.js', 'localhost')).status, 200, 'a backslash separates');
  assert.equal((await raw(p, '/LIBRAR~1/page.js', 'localhost')).status, 200, 'and a short name opens its folder');
  assert.equal((await raw(p, '/scripts%5Chosts.js', 'localhost')).status, 404, 'the dev server\'s own source is not the site behind a backslash');
  assert.equal((await raw(p, '/SCRIPT~1/hosts.js', 'localhost')).status, 404, 'nor by its folder\'s short name');
  assert.equal((await raw(p, '/%5C.secret%5Ckey.txt', 'localhost')).status, 404, 'a dot folder behind backslashes');
  assert.equal((await raw(p, '/scripts%5C..%5C.secret%5Ckey.txt', 'localhost')).status, 404, 'or behind a step back');
  assert.equal((await raw(p, '/SECRET~1/key.txt', 'localhost')).status, 404, 'or by its 8.3 short name');
  assert.equal((await raw(p, '/secret~1/key.txt', 'localhost')).status, 404, 'in any case');
  assert.equal((await raw(p, '/elsewhere.txt', 'localhost')).status, 404, 'nor a file on another drive by a link to it');
  assert.equal((await raw(p, '/index.html', 'localhost')).status, 200, 'and the page is still served');
});
