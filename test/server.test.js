const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

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
